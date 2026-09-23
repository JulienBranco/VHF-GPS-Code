# VHF GPS Code — installation hors réseau

L'application est autonome : le protocole radio et les calculs restent dans `vhf_gps_code.html`. La PWA ajoute un manifeste, des icônes et un service worker qui conserve l'ensemble des fichiers nécessaires sur le téléphone. Aucune connexion n'est nécessaire après une première installation réussie.

## Distribution

Publier **ensemble** `index.html`, `vhf_gps_code.html`, `manifest.webmanifest`, `sw.js` et le dossier `icons/` à la racine d'une même adresse HTTPS stable. Les chemins sont relatifs et conviennent aussi à un sous-dossier, par exemple GitHub Pages. L'ouverture directe du fichier HTML reste possible, mais ne permet pas l'installation de la PWA.

Avant la sortie, ouvrir l'adresse avec du réseau, puis utiliser le bouton **« Installer l'application »** en haut de la page :

- Android : si Chrome propose l'installation directe, confirmer sa fenêtre. Sinon, le bouton indique le chemin par le menu du navigateur.
- iPhone : le bouton indique les gestes Safari → Partager → « Sur l'écran d'accueil » ; Safari ne permet pas à la page de lancer directement cette confirmation.

**Ouvrir ensuite l'icône installée avec du réseau** et attendre l'indication **« PRÊTE HORS RÉSEAU »** dans cette application. Sur iPhone, le stockage de la web app peut être séparé de celui de Safari : une indication « prête » dans Safari ne suffit pas pour garantir que l'icône installée ouvrira hors réseau.

Passer en mode avion, fermer l'application, puis la rouvrir depuis son icône. Vérifier la session, les zones et l'acquisition GPS sur **chaque modèle de téléphone utilisé**. Le GPS dispose de 60 secondes pour obtenir une position récente ; la saisie depuis le sondeur/traceur reste disponible.

Une PWA installée depuis HTTPS possède un espace de stockage distinct de celui d'un fichier HTML ouvert localement. Sur iPhone, elle peut aussi être distincte de Safari. Les secrets et les zones personnalisées déjà saisis ailleurs ne sont donc pas transférés automatiquement. Les données du navigateur peuvent aussi être effacées par l'utilisateur ou par le système ; avant une sortie, vérifier qu'elles sont toujours présentes.

## Développement et mises à jour

Tester sur cet ordinateur avec `node tools/dev-server.cjs`, puis ouvrir `http://localhost:8080/`. `localhost` permet de tester les service workers sans certificat HTTPS. Pour un essai hors ligne, charger la page une première fois, attendre « PRÊTE HORS RÉSEAU », puis couper le réseau dans les outils du navigateur et rouvrir l'application.

À chaque évolution, incrémenter **à la fois** `APP_VERSION` dans `vhf_gps_code.html` et `APP_VERSION` dans `sw.js`. Les tests vérifient cette concordance. Le nouveau cache doit être entièrement téléchargé avant d'être utilisé. Une mise à jour n'impose jamais de rechargement au cours d'un échange radio : fermer puis rouvrir l'application à quai.

Les fichiers `icons/*.png` sont générés par `tools/generate_pwa_icons.py` avec Pillow. Ils ne sont pas requis pour recalculer le protocole.
