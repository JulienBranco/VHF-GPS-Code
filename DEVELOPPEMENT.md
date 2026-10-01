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
- `sources/point-tracking.js`, `point-tracking-math.js`, `point-tracking.css` : modale de suivi, calculs locaux et styles isolés.
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

## Préciser la demande de release, de purge ou de reset

Ces trois demandes ont des effets différents :

| Demande | Publications sur le serveur après commit et push | Données des téléphones |
| --- | --- | --- |
| **Prépare une release** | Ajouter la nouvelle publication et conserver les précédentes. | Conserver les sorties enregistrées ; une sortie active garde sa publication. |
| **Release + purge** | Ajouter la nouvelle publication et retirer les anciennes selon la règle précisée : nombre à garder et/ou date limite. La publication actuelle reste protégée. | Aucun reset. Une sortie complète déjà conservée localement reste utilisable ; une invitation dont la publication a été retirée peut ne plus être installable ou réparable. |
| **Release + reset complet** | Préparer la nouvelle publication et ne conserver que celle-ci. | Quand le téléphone télécharge et active le nouvel accueil, effacer les sorties enregistrées et les copies locales de publications, puis revenir à l’accueil. Une sortie en cours peut être interrompue. |

**Un reset complet exige une demande explicite.** Une demande de purge, même pour ne
conserver qu’une publication, ne vaut pas autorisation de réinitialiser les téléphones.
Si la règle de purge n’est pas précisée et qu’aucune règle n’a été convenue, la clarifier
avant toute suppression. Les commandes Git restent séparées : aucun commit ni push sans autorisation explicite.

Une publication normale et une purge ordinaire conservent le marqueur de reset existant.
Chaque reset complet crée un nouveau marqueur ; un téléphone applique son effacement
une seule fois pour ce marqueur. Hors réseau, il ne reçoit pas encore cette remise à zéro.
Il n’y a aucune expiration automatique des sessions selon leur âge.
Le nettoyage automatique des copies inutiles après sauvegarde d’une nouvelle sortie reste
indépendant de ces demandes et protège la sortie active ainsi que les pages encore ouvertes.

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

Pendant les retouches locales, `npm run test:sources` lance toutes les suites sans exiger
une nouvelle publication. Les publications de test sont préparées en mémoire.
`npm run test:unit` lance seulement les contrôles sans navigateur. `npm run test:browser` lance uniquement les parcours navigateur
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

## Suivi du point reçu (module facultatif)

Le bouton « Suivre le point reçu » apparaît dans le résultat après confirmation complète de l’échange radio. La modale démarre un suivi GPS et demande le maintien de l’écran. La fermeture (bouton, Échap/Retour natif ou départ de la page) arrête le suivi et libère le maintien de l’écran. En arrière-plan le GPS est arrêté ; au retour, une nouvelle mesure est exigée avant les estimations. Le maintien de l’écran dépend du téléphone, notamment d’iOS 18.4 ou ultérieur en PWA installée, et peut être refusé ou retiré par le système.

La vue SVG reste au nord, affiche les deux points, une direction directe en pointillés et une trace temporaire. Les boutons +/− et le déplacement tactile passent en cadrage manuel ; « Cadrer les deux points » réactive le cadrage automatique. La trace est limitée à 1 000 points en mémoire et disparaît à la fermeture : aucune donnée de suivi n’est écrite dans le stockage de la sortie. Le point reçu est fixe ; aucun déplacement ultérieur du bateau émetteur n’est connu.

La vitesse est lissée sur les mesures récentes. Si le GPS ne la fournit pas, elle est estimée à partir de déplacements suffisamment grands et espacés. L’arrivée utilise la vitesse de rapprochement vers le point, après plusieurs relevés. Elle est suspendue à faible vitesse, en éloignement, pour un relevé de plus de 20 secondes ou une précision annoncée dépassant 100 m. La proximité tient compte de la cellule de 100 m et de la précision GPS. Les directions sont exprimées par rapport au nord vrai ; la vue ne contient ni carte marine ni calcul de dangers.

Les trois fichiers du module sont inclus dans le manifeste de chaque nouvelle publication, vérifiés et conservés dans son cache avec l’application. Il n’existe aucun appel réseau dans le module. Les calculs et styles sont chargés avec la publication : une mise à jour de l’accueil ne les remplace pas. Aucun changement de PROTO ou COMPAT.

Pour désactiver cette fonctionnalité, passer `POINT_TRACKING_ENABLED` à `false` dans `sources/runtime.js` : le bouton disparaît et le module n’est plus initialisé. Le moteur et le calcul manuel existant continuent de fonctionner. Une erreur d’initialisation du module désactive seulement son bouton. Pour retirer totalement le code plus tard, enlever également le bouton/lien CSS de `sources/app.html`, le raccord `confirmedTrackingPoint` de `sources/app-adapter.js`, l’événement `vhf-position-reset` de `sources/engine.js` et les trois fichiers des listes de `tools/build.cjs` et `tools/live-server.cjs`, puis supprimer les fichiers et tests dédiés. Les publications déjà diffusées restent immuables.

Tests ciblés sans génération : `node --test tests/point-tracking-math.test.cjs tests/point-tracking.test.cjs`. Ils font aussi partie de `npm run test:sources` et de `npm test`. Les tests navigateur vérifient la reprise hors réseau, les fermetures, les callbacks tardifs, la veille, les erreurs GPS, le zoom et la géolocalisation Chromium. Les comportements de mise en veille et de Retour natif restent à confirmer sur de vrais Android/iPhone.
