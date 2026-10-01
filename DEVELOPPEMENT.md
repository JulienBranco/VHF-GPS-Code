# Développer et publier VHF GPS

Ce guide concerne le PC de développement. Les téléphones n’ont besoin d’aucun de ces outils.
Node.js 22 ou plus récent doit être installé sur le PC. Aucun outil ne fait de commit ou de push.

## Modifier et voir immédiatement le résultat

Dans un terminal ouvert dans le dossier du projet :

```powershell
node tools/live-server.cjs 8083
```

Ouvrir http://127.0.0.1:8083/. Modifier les sources puis recharger la page.
Garder le terminal ouvert ; Ctrl+C arrête le serveur.

- `sources/app.html` : interface et styles de l’application.
- `sources/engine.js` : moteur, mots, zones et échanges.
- `sources/app-adapter.js` et `sources/runtime.js` : préparation, import, sauvegarde et reprise.
- `index.html`, `style.css`, `boot.js` : accueil, appelé launcher.
- `protocol.js`, `storage.js`, `release.js`, `transition.js`, `transition.css`, `technical-info.js` : modules utilisés par le launcher et copiés dans les publications.
- `install.js`, `manifest.webmanifest`, `icons/` : installation et identité de l’application.
- `tools/sw.template.js` : source du gestionnaire hors connexion ; `sw.js` est généré.

L’adresse `releases/dddd…/app.html` de cet aperçu est fictive. Le serveur lit directement
les sources ; il ne crée aucune publication. Ne pas partager ses invitations.
Cet aperçu ne sert pas à valider l’installation ni le hors connexion.

Le panneau replié « Informations techniques », en bas de l’accueil et de l’application,
identifie l’accueil installé et la publication utilisée par la sortie. L’identifiant de
l’accueil est calculé automatiquement à partir de ses fichiers ; il n’y a pas de deuxième
numéro de version à gérer. Une mise à jour en attente n’est pas présentée comme déjà installée.
L’aperçu local affiche « Aperçu local — sources » à la place de cet identifiant.

## Préparer une publication quand les modifications sont terminées

Double-cliquer sur **PUBLICATIONS.cmd**, puis choisir **1 · Préparer une publication**.
Le menu demande le numéro de version, par exemple `3.28.109`, puis une confirmation.
Il renseigne `APP_VERSION` dans les sources et prépare les fichiers.
Changer le numéro lors d’une nouvelle publication ; pas à chaque retouche locale.

L’outil copie les sources dans `releases/<empreinte>/` et synchronise :

- `manifest.json` dans la publication : liste et empreintes de ses fichiers ;
- `latest.json` : publication à télécharger pour une nouvelle sortie ;
- `releases.json` : catalogue avec versions et dates ;
- `RELEASES.html` : catalogue lisible ;
- `sw.js` : fichiers du launcher à conserver hors connexion.

Ne pas modifier ces fichiers générés à la main. Les fichiers d’une publication existante
ne sont jamais remplacés par une autre version.

Le choix **2 · Vérifier** vérifie la correspondance des sources et des fichiers générés.
Il ne remplace pas les tests fonctionnels ou les essais sur téléphone.

## Tester les fichiers qui seront publiés

```powershell
node tools/server.cjs 8082
```

Ouvrir http://127.0.0.1:8082/. Ce serveur utilise la publication préparée et le mécanisme
hors connexion réel. Le serveur 8083 reste réservé au développement.
Les deux ports ont des données de navigateur séparées.

La première fois sur un PC, installer les dépendances verrouillées et le navigateur de test :

```powershell
npm ci
npm run test:install
```

Ces deux étapes demandent Internet. Les dépendances restent dans `node_modules/` et le navigateur
dans le cache Playwright du PC : rien de cela n’est envoyé aux téléphones ni à Git.
Le fichier `package-lock.json`, lui, doit être conservé dans Git pour réinstaller les mêmes versions.

Ensuite, lancer tous les tests avec :

```powershell
npm test
```

Cette commande vérifie d’abord que la publication est synchronisée avec les sources, puis lance
les contrôles du moteur, des publications, des purges et les parcours navigateur. Elle ne génère
aucune release dans le projet et n’exécute aucun commit ou push. Les tests de génération et de purge
travaillent dans des dossiers temporaires isolés.

Pendant les retouches locales, `npm run test:unit` lance les contrôles sans navigateur et n’exige
pas de nouvelle publication. `npm run test:browser` lance uniquement les parcours navigateur
et vérifie d’abord la publication préparée. Les tests utilisent le Chromium installé par Playwright,
sans dépendre de l’emplacement de Chrome sur ton PC ni de Codex.

Après un changement de `package-lock.json`, relancer `npm ci` et `npm run test:install`.
Sur Linux, si des bibliothèques système manquent, suivre la section Tests du README.

Quand tout est prêt, examiner les changements dans GitHub Desktop, **commit et push soi-même**.
Inclure les sources et les fichiers générés. GitHub Pages ne génère rien à la place de l’outil.

## Afficher ou purger les publications

Dans **PUBLICATIONS.cmd**, le choix **3** affiche les publications et leurs dates.
Le choix **4** propose quatre règles :

1. Garder les X dernières, avec au moins une publication.
2. Supprimer avant une date, en heure de Paris. Une publication du jour choisi est conservée.
3. Garder les X dernières **et** toutes celles depuis une date : l’un ou l’autre suffit à conserver une publication.
4. Remise à zéro complète : générer les sources actuelles, ne conserver que cette publication et abandonner les anciennes sorties sur les téléphones qui recevront la mise à jour.

La publication actuelle est toujours protégée. Les publications dont la date de création
est inconnue sont conservées par une règle de date ; la liste le signale.
Une purge ordinaire exige une publication synchronisée avec les sources. Si ce n’est pas
le cas, préparer d’abord la publication avec le choix 1. La quatrième règle accepte les
sources modifiées puisqu’elle prépare explicitement leur publication avant de retirer les anciennes.
Elle utilise le numéro déjà présent dans `APP_VERSION` ; changer ce numéro avec le choix 1 si nécessaire.

Le menu affiche **CONSERVÉES** et **SUPPRIMÉES** avant toute modification.
Seule la saisie exacte de **SUPPRIMER** applique la purge. Annuler ne modifie rien.
Les catalogues, `latest.json` et `sw.js` sont mis à jour ensemble, puis vérifiés.

La purge agit d’abord sur le projet local. Elle arrive sur GitHub Pages après ton commit et ton push.
Les invitations des publications retirées ne permettront plus leur téléchargement ou leur réparation
depuis le serveur. Une purge ordinaire préserve les sorties actives des téléphones.
La quatrième règle remet aussi à zéro les données des téléphones lorsqu’ils téléchargent
le nouvel accueil avec du réseau. Un marqueur conservé dans releases.json évite de répéter
cet effacement aux réouvertures. Prévenir les testeurs avant de publier une remise à zéro complète.

En cas d’échec pendant la purge, l’outil restaure les dossiers et les métadonnées.
S’il est fermé brutalement, rouvrir **PUBLICATIONS.cmd** : le journal permet de restaurer
une purge inachevée ou de terminer le nettoyage d’une purge déjà validée.
Le dossier temporaire `.release-maintenance` est exclu de Git ; ne pas le supprimer à la main.

Le générateur refuse désormais une publication référencée dont les fichiers ont disparu.
Ne pas supprimer les dossiers de `releases/` dans l’Explorateur : utiliser le menu.

## Comprendre la mise à jour côté pêcheur

L’icône ouvre le launcher. Il propose de reprendre, préparer ou recevoir une sortie.

- Reprendre ouvre la publication exacte enregistrée dans la sortie active.
- Préparer consulte `latest.json` avec Internet.
- Recevoir suit la publication indiquée par l’invitation ; ce peut être une ancienne publication.

Le launcher se télécharge entièrement et vérifie ses fichiers avant de s’activer.
L’accueil ouvert s’actualise automatiquement, en conservant une invitation collée ;
une préparation en cours termine d’abord. La page d’une sortie active reste sur sa publication,
sans rechargement ni perte des saisies. La vérification est relancée au retour du réseau et au premier plan.
Après confirmation et sauvegarde d’une nouvelle sortie, créée ou importée, les copies de
publications inutiles sont retirées. La sortie active et les autres pages ouvertes restent protégées.
Seule la remise à zéro complète volontaire abandonne les anciennes sorties.

Pour vérifier les sources sans préparer une publication : `npm run test:sources`.
