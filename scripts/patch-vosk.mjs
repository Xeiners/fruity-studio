/**
 * Prepare la copie de vosk-browser 0.0.8 livree avec l'application.
 *
 * Le paquet d'origine cache son worker dans une URL blob et genere du code avec `new Function`,
 * ce que la politique de securite de l'application interdit a juste titre. Ce script sort le worker
 * dans un fichier normal et remplace les trois generateurs de code par des fonctions ordinaires.
 *
 * Usage : node scripts/patch-vosk.mjs --es-module   (convertit seulement la copie deja livree)
 *         node scripts/patch-vosk.mjs <chemin vers le dist/vosk.js du paquet npm vosk-browser@0.0.8>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , sourcePath] = process.argv;
if (sourcePath === "--es-module") {
  const target = path.join(root, "vendor", "vosk-browser", "dist", "vosk.js");
  fs.writeFileSync(target, toEsModule(fs.readFileSync(target, "utf8")));
  console.log("vendor/vosk-browser/dist/vosk.js converti en module ES");
  process.exit(0);
}
if (!sourcePath) throw new Error("Indiquez le chemin du dist/vosk.js d'origine.");

const WORKER_URL = "/vosk-worker.js";
const bundle = fs.readFileSync(sourcePath, "utf8");

function required(text, needle, from = 0) {
  const at = text.indexOf(needle, from);
  if (at < 0) throw new Error(`Repere introuvable, version de vosk-browser differente ? ${needle}`);
  return at;
}

/** Remplace le texte entre deux reperes exacts ; `end` reste en place. */
function replaceBetween(text, start, end, replacement) {
  const from = required(text, start);
  const to = required(text, end, from);
  return `${text.slice(0, from)}${replacement}${text.slice(to)}`;
}

// 1. Le worker quitte le blob : il devient un fichier servi par l'application.
const factoryCall = "var WorkerFactory = createBase64WorkerFactory('";
const factoryEnd = "', null, false);";
const base64Start = required(bundle, factoryCall) + factoryCall.length;
const base64End = required(bundle, factoryEnd, base64Start);
const decoded = Buffer.from(bundle.slice(base64Start, base64End), "base64").toString("latin1");
const mainBundle = `${bundle.slice(0, base64Start - factoryCall.length)}var WorkerFactory = function (options) { return new Worker(${JSON.stringify(WORKER_URL)}, options); };${bundle.slice(base64End + factoryEnd.length)}`;

/**
 * Le paquet est au format UMD : Vite le convertit au build, mais le sert tel quel en dev
 * (paquet local), d'ou l'erreur « does not provide an export named 'createModel' ».
 * On le transforme donc en vrai module ES.
 */
function toEsModule(umd) {
  const header = "(function (global, factory) {";
  const factoryStart = "})(this, (function (exports) { 'use strict';";
  const footer = "\n}));";
  if (!umd.startsWith(header)) throw new Error("En-tete UMD introuvable.");
  const bodyStart = required(umd, factoryStart) + factoryStart.length;
  const bodyEnd = umd.lastIndexOf(footer);
  if (bodyEnd < bodyStart) throw new Error("Fin UMD introuvable.");
  return `const __vosk = {};\n(function (exports) { 'use strict';${umd.slice(bodyStart, bodyEnd)}\n})(__vosk);\n\nexport const Model = __vosk.Model;\nexport const createModel = __vosk.createModel;\n`;
}

// Meme decoupe que le chargeur d'origine : la premiere ligne n'est qu'un commentaire.
let worker = decoded.slice(decoded.indexOf("\n", 10) + 1);

// 2. Generateurs de code d'Emscripten remplaces par leur equivalent sans evaluation.
worker = replaceBetween(
  worker,
  "function createNamedFunction(name,body){",
  "var emval_free_list=[];",
  'function createNamedFunction(name,body){name=makeLegalFunctionName(name);return {[name]:function(){return body.apply(this,arguments)}}[name]}',
);

worker = replaceBetween(
  worker,
  "function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){",
  "function heap32VectorToArray(",
  `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
var argCount=argTypes.length;
if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");}
var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
var needsDestructorStack=false;
for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}
var returns=argTypes[0].name!=="void";
var expected=argCount-2;
return function(){
if(arguments.length!==expected){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expected+" args!");}
var destructors=needsDestructorStack?[]:null;
var wired=new Array(expected);
var invokerArgs=[cppTargetFunc];
var thisWired;
if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);invokerArgs.push(thisWired);}
for(var a=0;a<expected;++a){wired[a]=argTypes[a+2].toWireType(destructors,arguments[a]);invokerArgs.push(wired[a]);}
var rv=cppInvokerFunc.apply(null,invokerArgs);
if(needsDestructorStack){runDestructors(destructors);}
else{for(var d=isClassMethodFunc?1:2;d<argTypes.length;++d){if(argTypes[d].destructorFunction!==null){argTypes[d].destructorFunction(d===1?thisWired:wired[d-2]);}}}
if(returns){return argTypes[0].fromWireType(rv);}
};
}`,
);

worker = replaceBetween(
  worker,
  "function __emval_get_method_caller(argCount,argTypes){",
  "function __emval_incref(",
  `function __emval_get_method_caller(argCount,argTypes){
var types=__emval_lookupTypes(argCount,argTypes);
var retType=types[0];
return __emval_addMethodCaller(function(handle,name,destructors,args){
var callArgs=new Array(argCount-1);
var offset=0;
for(var i=0;i<argCount-1;++i){callArgs[i]=types[i+1].readValueFromPointer(args+offset);offset+=types[i+1]["argPackAdvance"];}
var rv=handle[name].apply(handle,callArgs);
for(var d=0;d<argCount-1;++d){if(types[d+1]["deleteObject"]){types[d+1].deleteObject(callArgs[d]);}}
if(!retType.isVoid){return retType.toWireType(destructors,rv);}
});
}`,
);

for (const forbidden of ["new Function", "new_(Function", "createBase64WorkerFactory('"]) {
  if (worker.includes(forbidden)) throw new Error(`Le worker contient encore : ${forbidden}`);
}

// 3. Ecriture de la copie livree.
const vendor = path.join(root, "vendor", "vosk-browser");
fs.mkdirSync(path.join(vendor, "dist"), { recursive: true });
fs.writeFileSync(path.join(vendor, "dist", "vosk.js"), toEsModule(mainBundle));
for (const types of ["interfaces.d.ts", "model.d.ts", "vosk.d.ts"]) {
  fs.copyFileSync(path.join(path.dirname(sourcePath), types), path.join(vendor, "dist", types));
}
fs.writeFileSync(
  path.join(vendor, "package.json"),
  `${JSON.stringify({ name: "vosk-browser", version: "0.0.8-fruity.1", description: "Copie modifiee de vosk-browser 0.0.8, voir MODIFICATIONS.md", type: "module", main: "./dist/vosk.js", module: "./dist/vosk.js", license: "Apache-2.0" }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(vendor, "MODIFICATIONS.md"),
  "# vosk-browser 0.0.8, copie modifiee\n\nOrigine : https://github.com/ccoreilly/vosk-browser (Ciaran O'Reilly, licence Apache-2.0).\n\nModifications, produites par `scripts/patch-vosk.mjs` :\n\n- le paquet principal est un module ES (au lieu d'UMD) ;\n- le worker est servi depuis `public/vosk-worker.js` au lieu d'une URL blob ;\n- `createNamedFunction`, `craftInvokerFunction` et `__emval_get_method_caller` n'utilisent plus `new Function`.\n",
);
// Le navigateur encode en UTF-8 le texte du blob d'origine : meme resultat ici.
fs.writeFileSync(path.join(root, "public", "vosk-worker.js"), worker, "utf8");

console.log(`vosk.js : ${mainBundle.length} caracteres, worker : ${worker.length} caracteres`);
console.log(`dependances externes dans le paquet principal : ${/require\(['"]|^import /m.test(mainBundle) ? "OUI, a verifier" : "aucune"}`);
