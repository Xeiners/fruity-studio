# vosk-browser 0.0.8, copie modifiee

Origine : https://github.com/ccoreilly/vosk-browser (Ciaran O'Reilly, licence Apache-2.0).

Modifications, produites par `scripts/patch-vosk.mjs` :

- le paquet principal est un module ES (au lieu d'UMD) ;
- le worker est servi depuis `public/vosk-worker.js` au lieu d'une URL blob ;
- `createNamedFunction`, `craftInvokerFunction` et `__emval_get_method_caller` n'utilisent plus `new Function`.
