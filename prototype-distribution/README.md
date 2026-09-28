# Prototype de distribution — essais uniquement

Ce dossier est indépendant de l'application de pêche. Il ne change ni son protocole,
ni son interface, ni son service worker. Ses codes TEST ne doivent jamais être utilisés à la VHF.

## Pour Julien : publier et essayer

1. Dans GitHub Desktop, ajouter le dossier `prototype-distribution/` au prochain commit.
   L'archive ZIP non suivie est indépendante de ce travail : ne pas l'ajouter par inadvertance.
2. Faire soi-même le commit et le push habituels. Aucun réglage GitHub Pages à changer si
   le dépôt publie déjà son dossier racine. Attendre la fin du déploiement Pages.
3. Depuis l'adresse habituelle du site, ouvrir `prototype-distribution/`.
   Avec l'adresse Pages standard du dépôt, cela donne :
   https://julienbranco.github.io/VHF-GPS-Code/prototype-distribution/
4. Dans Chrome Android, installer **VHF GPS TEST**, puis suivre le
   [guide Android](GUIDE.html), également accessible dans « Scénario de test ».

Les fichiers générés sont déjà présents : aucune commande à lancer pour cet essai.
Ne pas remplacer les fichiers de l'application réelle par ceux de ce dossier.

## Ce que l'essai démontre

- La création vérifie en ligne une publication annoncée.
- Une invitation désigne un ensemble exact de fichiers, vérifiés par SHA-256.
- Le destinataire installe cet ensemble, même si une publication plus récente existe.
- Une sortie installée conserve son interface et son calcul de démonstration.
- La restauration d'une sortie connue fonctionne hors connexion si son cache est intact.
- Une nouvelle activation enregistre sa configuration complète dans une transaction IndexedDB.
  Un échec de téléchargement, une annulation ou une transaction abandonnée préserve la sortie précédente.
- Deux préparations concurrentes sur le même téléphone ne s'écrasent pas silencieusement.

A et B sont de petites applications distinctes, avec des protocoles fictifs volontairement
incompatibles. Ce n'est pas encore le moteur VHF. Le choix A/B dans le panneau de test simule
la publication annoncée, mais les téléchargements, caches, transactions et reprises sont réels.
Les tests automatisés changent également la réponse réelle de `latest.json` sur un serveur local.

## Limites explicites avant toute intégration

- Chrome de bureau automatisé ne valide ni Android réel, ni Safari/iOS. Les essais mobiles restent nécessaires.
- Une suppression/éviction du stockage peut rendre la sortie indisponible. On l'annonce sans
  basculer vers un autre moteur ; le rejeu en ligne répare les fichiers de la version demandée.
- Les empreintes détectent une modification accidentelle ; elles n'authentifient pas l'expéditeur.
- La préparation vérifie la publication au début. Une publication mondiale parfaitement simultanée
  n'est pas garantie ; une invitation conserve sa version exacte même si le serveur évolue entretemps.
- Les anciennes publications doivent rester disponibles sur l'hébergement pour les premiers imports
  et réparations. Il s'agit de conserver des fichiers, pas de maintenir plusieurs branches du moteur.
- Le lanceur reste un composant commun. Ses futures évolutions doivent préserver le format des sorties,
  les caches et l'interface de chargement. Ce prototype ne garantit pas qu'une modification arbitraire
  du lanceur sera compatible.
- Le schéma IndexedDB reste en version 1 dans ce prototype. Les migrations futures ne sont pas implémentées.
- Pas de nettoyage automatique des anciennes publications dans cette démonstration.
- Le vrai moteur, ses zones, l'import réel, le GPS et les échanges radio ne sont pas intégrés ici.

## Pour le développement

Node.js suffit à générer les fichiers ; Git et GitHub ne sont pas nécessaires à la génération.

```text
node prototype-distribution/tools/build.cjs
node prototype-distribution/tools/build.cjs --check
node prototype-distribution/tools/server.cjs
```

Le serveur local affiche son adresse. Sur téléphone, utiliser un hébergement HTTPS ;
une adresse HTTP de réseau local n'offre pas les mêmes capacités PWA que localhost.

Après modification d'un fichier du lanceur, relancer le générateur avant publication.
Il calcule les empreintes du lanceur et des deux démonstrations. Les règles de fins de ligne
dans `.gitattributes` évitent de changer ces empreintes entre Windows et l'hébergement.

Pour annoncer réellement B : `node prototype-distribution/tools/build.cjs --latest B`.
La vérification correspondante prend aussi `--latest B`.

Tests de navigateur (Playwright et Chrome requis ; aucune dépendance dans l'application publiée) :

```text
node --test prototype-distribution/tests/distribution.test.cjs
```

Le test cherche Playwright installé normalement, puis le runtime local de Codex.
`PROTOTYPE_CHROME` permet de choisir le chemin de Chrome.
Les tests simulent plusieurs téléphones avec des stockages indépendants, mais ne prétendent
pas avoir été exécutés sur des téléphones physiques.

L'hébergement doit publier les fichiers sans les réécrire et conserver les anciens dossiers
`releases/<empreinte>/`. Le prototype est un dossier statique portable vers un autre
hébergeur HTTPS ; aucun service GitHub n'est appelé par son fonctionnement.

## Contrat de chargement et test de mise à jour

Le manifeste de publication et les messages `initialize`, `ready` et `error`
portent désormais `api: 1`. Le lanceur contrôle la version avant le chargement
puis à la réception de la réponse. La publication contrôle aussi la demande avant ses
calculs. Un dialogue absent ou inconnu bloque la nouvelle activation avec un message,
sans remplacer la sortie active.

Les premières démonstrations sans numéro d'API ne sont pas migrées : leurs fichiers
restent conservés, mais leurs invitations d'essai sont refusées par ce lanceur.
Si une sortie avait été créée dans ce tout premier prototype, préparer une nouvelle
sortie d'essai. Cela ne concerne aucune session de l'application de pêche.

Le scénario automatique de mise à jour sert réellement un autre `boot.js` :
sa fonction d'affichage ajoute un préfixe visible. Le serveur de test recalcule les
empreintes du lanceur, attend l'activation de son nouveau worker, puis ferme entièrement
Chromium et le relance hors connexion avec le même profil. Le test exige :
- l'exécution du nouveau code de démarrage, constatée à l'écran ;
- le même code de sortie ;
- la configuration enregistrée strictement identique.

Quatre autres cas simulent une API absente ou inconnue, dans chaque sens du dialogue,
et vérifient le refus ainsi que la conservation de la sortie précédente.
Ces simulations sont limitées au serveur et au navigateur de test.
