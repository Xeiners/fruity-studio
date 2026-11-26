# Fruity Studio

Studio de production local (Windows) pour créer des vidéos TikTok de personnages fruits générées par IA :

1. **Bibliothèque de personnages** permanente (fiche complète + images de référence par angle).
2. **Génération d'histoires** drôles et cohérentes avec Gemini, découpées en clips connectés.
3. **Un prompt Google Flow par clip**, prêt à copier-coller.
4. **Import des vidéos** générées dans Flow, associées explicitement à leur clip.
5. **Assemblage automatique** (FFmpeg) en un MP4 vertical 1080×1920, 30 i/s, H.264 + AAC.

Google Flow reste le moteur de génération vidéo (vos crédits gratuits) : Fruity Studio n'appelle aucune API vidéo payante.

---

## Prérequis (Windows 10/11)

| Outil | Version testée | Installation |
|---|---|---|
| Node.js | 22+ (testé avec 26) | https://nodejs.org |
| Rust (MSVC) | 1.85+ (testé avec 1.98) | https://rustup.rs |
| Visual Studio Build Tools | 2022, charge « Développement Desktop C++ » | https://visualstudio.microsoft.com/fr/visual-cpp-build-tools/ |
| WebView2 | inclus dans Windows 11 | — |
| **FFmpeg** (rendu final) | 6+ avec libx264 | **Un clic dans l'application** (voir ci-dessous) |

### FFmpeg en un clic

Au lancement, l'assistant de configuration propose **Installer FFmpeg automatiquement** (le bouton existe aussi dans le tableau de bord, le panneau de rendu et **Paramètres › Vidéo & rendu**) :

1. téléchargement (≈ 110 Mo) des builds Windows de gyan.dev, référencés par ffmpeg.org, depuis leur miroir GitHub, avec repli sur gyan.dev ;
2. vérification de l'empreinte SHA-256 publiée par gyan.dev ;
3. extraction de `ffmpeg.exe` et `ffprobe.exe` uniquement, dans `%LOCALAPPDATA%\com.fruitystudio.desktop\tools\ffmpeg` ;
4. test de l'exécutable et des encodeurs H.264 / AAC.

Aucun droit administrateur, aucune modification du PATH ni du registre. Le bouton **Désinstaller** supprime simplement ce dossier, et **Tester l'encodage** produit une vidéo de test 1080×1920 H.264 + AAC.

Un FFmpeg déjà présent est aussi détecté automatiquement : PATH, WinGet, Scoop, Chocolatey, `C:\ffmpeg\bin`, ou chemin personnalisé dans **Paramètres › Vidéo & rendu**. Alternative manuelle : `winget install --id Gyan.FFmpeg -e`.

## Lancer l'application

```powershell
cd C:\dev\fruity-studio
npm install
npm run tauri dev
```

Le premier lancement compile la partie Rust (quelques minutes) ; les suivants sont rapides.

### Créer l'installeur Windows

```powershell
npm run tauri build
```

Résultat : `src-tauri\target\release\bundle\nsis\Fruity Studio_0.1.0_x64-setup.exe` (et `.msi`). Au premier build, Tauri télécharge automatiquement NSIS et WiX.
L'exécutable seul (sans installeur) : `npx tauri build --no-bundle` → `src-tauri\target\release\fruity-studio.exe`.

## Configurer Gemini

1. Créez une clé gratuite sur **https://aistudio.google.com/apikey**.
2. Au lancement, l'**assistant de configuration** s'ouvre tant que la clé ou FFmpeg manque : collez la clé dans l'étape 1 puis cliquez sur **Enregistrer et tester**.
3. Pour y revenir : cliquez sur la pastille **Gemini** en bas de la barre latérale, ou allez dans **Paramètres › Gemini** (`Ctrl+,`).

Une clé refusée par Google est retirée automatiquement ; si le modèle par défaut n'est pas proposé à votre clé, Fruity Studio bascule sur un modèle disponible.

- La clé est stockée dans le **Gestionnaire d'identification Windows** (entrée `com.fruitystudio.desktop`). Elle n'est jamais écrite en clair, jamais renvoyée à l'interface ni journalisée.
- Le SDK officiel `@google/genai` est utilisé côté interface avec une clé factice : chaque requête passe par la commande Rust `gemini_http`, qui n'autorise que `https://generativelanguage.googleapis.com` et injecte la vraie clé.
- Modèle par défaut : `gemini-3.8-flash` (Flash stable en novembre 2026).
- **Détection automatique des modèles** : avant chaque génération, Fruity Studio lit les modèles réellement proposés à votre clé. Si le modèle choisi est absent, saturé ou à court de quota, il passe au suivant (4 modèles au maximum par génération) et affiche celui qui a servi. Un modèle qui ne répond pas à temps est évité pendant 24 h. Ce modèle est mémorisé avec la production ou la version du personnage.
- **Quotas gratuits** : limites par minute (RPM/TPM) et par jour (RPD), **par projet** Google Cloud, réinitialisées à minuit heure du Pacifique (9 h en France). Une histoire ou une fiche de personnage = 1 requête (2 si correction automatique). Après une erreur 429, le même modèle n'est jamais réessayé automatiquement ; si aucun modèle ne répond, l'application explique quand réessayer.

## Flux de travail

1. **Personnages** › Nouveau personnage → nom, fruit, description courte, personnalité, ton de la voix, puis **Générer mon personnage**. Gemini écrit un prompt unique, sans rien ajouter à votre description.
2. Dans la fiche : copiez le prompt et collez-le dans **Google Flow, section personnage** pour obtenir une image du personnage de face, de trois-quarts et de profil. **Importer l'image** (ou glisser-déposer) la range dans la galerie. Pour itérer, modifiez les informations ou indiquez ce qu'il faut changer, puis **Régénérer** : chaque version est conservée, et le personnage reste en brouillon tant que vous ne le marquez pas comme terminé.
3. **Nouvelle production** (`Ctrl+N`) → sélectionnez les personnages → **Générer l'histoire** (`Ctrl+Entrée`). Idée, style, durée, langue : optionnels. Cochez **Ajouter d'autres personnages** pour que Gemini invente des fruits au hasard qui arrivent au fil de l'histoire et créent la scène comique avec votre casting ; ils sont décrits dans chaque prompt vidéo où ils apparaissent.
4. Dans l'espace de production : **Références Flow** exporte les images dans un dossier à importer dans Flow (Flow n'a pas accès aux fichiers locaux).
5. **Copier le prompt** du clip 1 → collez-le dans Google Flow → téléchargez la vidéo.
6. Glissez la vidéo sur **la carte du clip 1** (ou « Importer »). Répétez pour chaque clip.
7. **Rendu de la vidéo finale** → aperçu, ouverture du dossier, MP4 prêt pour TikTok.

Garde-fous d'association : un fichier dont le nom indique un autre numéro de clip demande confirmation ; une même vidéo ne peut pas être associée à deux clips ; l'import multiple exige une association explicite fichier par fichier ; le rendu trie toujours par numéro de clip et refuse de démarrer s'il manque une vidéo.

## Mes réseaux

TikTok Studio et YouTube Studio s'ouvrent dans l'application, à côté du texte de publication écrit par Gemini (légende, titre, description, hashtags). Vous vous connectez une seule fois, déposez la vidéo sur le site, collez le texte et cliquez sur Publier. Fruity Studio ne publie jamais à votre place, et ces pages n'ont accès ni à votre clé Gemini ni aux commandes de l'application. Si un site refuse la connexion dans l'application, **Ouvrir dans mon navigateur** reste disponible.

## Dictée vocale

Le bouton **Dicter** des champs de description écrit le texte pendant que vous parlez. La reconnaissance tourne dans l'application avec Vosk et un petit modèle français, sans compte, sans quota et sans envoyer votre voix sur Internet. La dictée s'arrête seule après 20 secondes de silence. Le dossier `vendor/vosk-browser` contient une copie modifiée de Vosk pour respecter la politique de sécurité de l'application (voir son fichier `MODIFICATIONS.md`).

## Rendu FFmpeg

- Clips déjà conformes (H.264 yuv420p, 1080×1920, 30 i/s, AAC homogène, sans transition ni musique) : **concaténation sans réencodage vidéo** (seul l'audio est normalisé).
- Sinon : normalisation complète (résolution avec fond flou / recadrage / bandes noires, cadence, audio stéréo 48 kHz, silence ajouté aux clips muets), puis encodage H.264 (libx264, repli h264_mf/nvenc/qsv/amf) + AAC 192 kb/s.
- Options : transitions (fondu, glissement…), normalisation du volume (-14 LUFS), volume des clips, musique de fond bouclée avec atténuation automatique sous les dialogues (sidechain) et fondu de fin.
- Progression en temps réel, annulation, fichier temporaire renommé seulement après vérification ffprobe ; journal complet dans `workspace\logs`.

## Où sont les données ?

| Élément | Emplacement par défaut |
|---|---|
| Base SQLite | `%APPDATA%\com.fruitystudio.desktop\fruity-studio.db` |
| Espace de travail (copies des médias, miniatures, journaux) | `%LOCALAPPDATA%\com.fruitystudio.desktop\workspace` |
| Exports (vidéos finales, références Flow) | `%USERPROFILE%\Videos\Fruity Studio` |
| Clé API | Gestionnaire d'identification Windows |

Les fichiers identiques sont dédupliqués (SHA-256). La variable d'environnement `FRUITY_STUDIO_DATA_DIR` permet d'isoler toutes les données (tests, profil portable).

## Architecture

```
src/
  components/      ui/ (shadcn/ui + Radix), layout/ (barre latérale, palette Ctrl+K), common/
  features/        dashboard, characters, stories (générateur), production (espace de travail, rendu), library, settings
  services/
    gemini/        client SDK + passerelle, schémas Zod/JSON Schema, prompts, composition des prompts Flow, erreurs/quotas
    ffmpeg/        détection, rendu, progression
    storage/       appels typés aux commandes Rust
  hooks/           TanStack Query, thème, glisser-déposer natif, raccourcis
  types/ utils/
src-tauri/src/
  db/              SQLite + migrations versionnées
  repo/            requêtes typées (personnages, productions, médias)
  commands/        commandes Tauri (async, traitements lourds hors du thread UI)
  ffmpeg/          détection, ffprobe, plan de rendu (fonctions pures testées), exécution
  media.rs         espace de travail, copies, déduplication
  secrets.rs       trousseau Windows
```

Stack : Tauri 2, React 19, TypeScript 6, Vite 8, Tailwind CSS 4, shadcn/ui (Radix), Lucide, TanStack Query, Zod 4, `@google/genai` 2.x, rusqlite (SQLite intégré), keyring, reqwest.

## Tests

```powershell
npm test                      # schémas Gemini, composition des prompts, erreurs/quotas, découpage
npm run typecheck
cd src-tauri; cargo test      # base, migrations, dépôts, plan FFmpeg, passerelle Gemini
```

Tests de rendu avec un vrai FFmpeg (clips synthétiques de résolutions/cadences/audio différents, transitions, musique, annulation) :

```powershell
# Après l'installation en un clic :
$env:FRUITY_TEST_FFMPEG_DIR = "$env:LOCALAPPDATA\com.fruitystudio.desktop\tools\ffmpeg"
cd src-tauri; cargo test ffmpeg
```

Test réseau de l'installateur (téléchargement réel, SHA-256, extraction, sans exécuter les binaires) : `$env:FRUITY_TEST_FFMPEG_DOWNLOAD = "1"; cargo test real_download`.

## Raccourcis

`Ctrl+K` palette · `Ctrl+N` nouvelle production · `Ctrl+1…6` navigation · `Ctrl+,` paramètres · `Ctrl+S` enregistrer un personnage · `Ctrl+Entrée` générer · `←/→` visionneuse d'images.
