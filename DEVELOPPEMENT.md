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
| **Release + purge** | Ajouter la nouvelle publication et retirer les anciennes selon la règle précisée : nombre à garder et/ou date limite. La publication actuelle reste protégée. | Aucun reset. Après réception du nouvel accueil vérifié, nettoyer les moteurs retirés du catalogue, sauf ceux utilisés par la sortie active, une page ouverte ou une préparation. Une invitation visant un moteur retiré peut ne plus être installable ou réparable. |
| **Release + reset complet** | Préparer la nouvelle publication et ne conserver que celle-ci. | Quand le téléphone télécharge et active le nouvel accueil, effacer les sorties enregistrées et les copies locales de publications, puis revenir à l’accueil. Une sortie en cours peut être interrompue. |

**Un reset complet exige une demande explicite.** Une demande de purge, même pour ne
conserver qu’une publication, ne vaut pas autorisation de réinitialiser les téléphones.
Si la règle de purge n’est pas précisée et qu’aucune règle n’a été convenue, la clarifier
avant toute suppression. Les commandes Git restent séparées : aucun commit ni push sans autorisation explicite.

Une publication normale et une purge ordinaire conservent le marqueur de reset existant.
Chaque reset complet crée un nouveau marqueur ; un téléphone applique son effacement
une seule fois pour ce marqueur. Hors réseau, il ne reçoit pas encore cette remise à zéro.
Il n’y a aucune expiration automatique des sessions selon leur âge.
La conservation des moteurs téléchargés suit le catalogue publié, indépendamment des données
privées de sortie. Les retraits sont appliqués après réception d'un nouvel accueil vérifié ;
la sortie active, les pages ouvertes et les préparations restent protégées.

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

Le panneau facultatif « Changer de canal VHF » est isolé dans
`sources/vhf-channels.js` et `sources/vhf-channels-model.js`. Il associe les canaux
navire à navire 6, 8, 72 et 77 à quatre mots distincts issus du catalogue existant
des empreintes, en écartant les entrées contenant plusieurs mots. Le calcul HMAC
utilise le secret canonique de la sortie et un domaine propre `VHF-CHANNELS-V1` ;
il ne dépend pas de la zone et ne modifie ni les invitations ni le protocole des positions.
Le tableau est calculé localement, sans stockage supplémentaire ni réseau.
Le pont conserve le secret et le catalogue pour le calcul ; le module d'affichage
reçoit uniquement des copies des quatre correspondances canal/mot. Son cache reste
privé au pont. Cela réduit les données transmises au module facultatif, sans créer
une frontière de sécurité entre les scripts de la même application.

La version V1 fige l’ordre des canaux, le calcul, le filtre et l’empreinte du catalogue.
Une modification du catalogue est refusée explicitement par ce module : ne pas changer
son empreinte attendue sans versionner les correspondances et leurs tests de référence.
Les tests comparent deux appareils, une implémentation indépendante, 500 sorties
sans doublons et une reprise hors connexion. Une panne du module ne bloque pas les positions.
Les scénarios de navigateur dans `tests/radio-navigation.test.cjs` couvrent aussi
le mémo flottant en jour/nuit sur mobile, ses liens vers les deux panneaux, l'attente
et la confirmation de zone, sa conservation hors connexion et les ancres après
encodage/décodage. Ils sont inclus dans `test`, `test:browser` et `test:sources`.

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
Le téléphone conserve les moteurs déjà téléchargés tant qu'ils figurent dans le catalogue.
Après activation d'un nouvel accueil vérifié, sauvegarde d'une sortie ou suppression de la
sortie active, il nettoie uniquement les moteurs dont le retrait a été confirmé. La sortie
active, les autres pages ouvertes et les préparations en cours restent protégées.
Seule la remise à zéro complète volontaire abandonne les anciennes sorties.

## Suivi d’un point (module facultatif)

Le bouton « Suivre le point reçu » apparaît dans le résultat après confirmation complète de l’échange radio. La modale démarre un suivi GPS et demande le maintien de l’écran. La fermeture (bouton, Échap/Retour natif ou départ de la page) arrête le suivi et libère le maintien de l’écran. En arrière-plan le GPS est arrêté ; au retour, une nouvelle mesure est exigée avant les estimations. Le maintien de l’écran dépend du téléphone, notamment d’iOS 18.4 ou ultérieur en PWA installée, et peut être refusé ou retiré par le système.

La vue SVG reste au nord, affiche les deux points, une direction directe en pointillés et une trace temporaire. Les boutons +/− et le déplacement tactile passent en cadrage manuel ; « Cadrer les deux points » réactive le cadrage automatique. La trace est limitée à 1 000 points en mémoire et disparaît à la fermeture : aucune donnée de suivi n’est écrite dans le stockage de la sortie. Le point reçu est fixe ; aucun déplacement ultérieur du bateau émetteur n’est connu.

La vitesse est lissée sur les mesures récentes. Si le GPS ne la fournit pas, elle est estimée à partir de déplacements suffisamment grands et espacés. L’arrivée utilise la vitesse de rapprochement vers le point, après plusieurs relevés. Elle est suspendue à faible vitesse, en éloignement, pour un relevé de plus de 20 secondes ou une précision annoncée dépassant 100 m. La proximité tient compte de la cellule de 100 m et de la précision GPS. Les directions sont exprimées par rapport au nord vrai ; la vue ne contient ni carte marine ni calcul de dangers.

Les trois fichiers du module sont inclus dans le manifeste de chaque nouvelle publication, vérifiés et conservés dans son cache avec l’application. Il n’existe aucun appel réseau dans le module. Les calculs et styles sont chargés avec la publication : une mise à jour de l’accueil ne les remplace pas. Aucun changement de PROTO ou COMPAT.

Pour désactiver cette fonctionnalité, passer `POINT_TRACKING_ENABLED` à `false` dans `sources/runtime.js` : les boutons de suivi disparaissent du résultat et du journal, et le module n’est plus initialisé. Le moteur et le calcul manuel existant continuent de fonctionner. Une erreur d’initialisation du module désactive seulement son bouton. Pour retirer totalement le code plus tard, enlever également le bouton/lien CSS de `sources/app.html`, le raccord `confirmedTrackingPoint` de `sources/app-adapter.js`, l’événement `vhf-position-reset` de `sources/engine.js` et les trois fichiers des listes de `tools/build.cjs` et `tools/live-server.cjs`, puis supprimer les fichiers et tests dédiés. Les publications déjà diffusées restent immuables.

Tests ciblés sans génération : `node --test tests/point-tracking-math.test.cjs tests/point-tracking.test.cjs`. Ils font aussi partie de `npm run test:sources` et de `npm test`. Les tests navigateur vérifient la reprise hors réseau, les fermetures, les callbacks tardifs, la veille, les erreurs GPS, le zoom et la géolocalisation Chromium. Les comportements de mise en veille et de Retour natif restent à confirmer sur de vrais Android/iPhone.

## Historique des positions

Le journal est un bloc dépliable dans la session, commun aux modes ÉMETTRE et RECEVOIR. Une entrée « Généré » est ajoutée après le contrôle inverse réussi, avec la position saisie. Une entrée « Reçu et confirmé » est ajoutée uniquement après le bon mot final, avec les coordonnées décodées. Il ne prouve pas qu’une phrase générée a été transmise. Chaque entrée mémorise sa date/heure locale, sa phrase, ses coordonnées et une copie de la zone (nom, type, centre et identifiant). La liste mélange les deux rôles par date décroissante ; à heure égale, la dernière insertion apparaît en premier. Une simple répétition de confirmation ne crée pas de doublon ; une nouvelle génération ou un nouvel échange crée une nouvelle entrée.

`sources/position-history-model.js` valide et copie une liste blanche de données ; `position-history.js` gère la sauvegarde et l’affichage ; `position-history.css` isole les styles. Le moteur émet `vhf-position-record` avec des données sans secret. La clé `vhfGpsPositionHistoryV1` appartient au stockage de la sortie ; elle est enregistrée par les transactions existantes et n’est jamais incluse dans l’invitation. Fermer et reprendre la sortie retrouve la liste, y compris hors réseau. Une seule sortie est conservée sur le téléphone. Préparer/importer une autre sortie supprime les données et le journal de la précédente dans la même transaction que sa sauvegarde. Rejouer une ancienne invitation recrée une sortie avec un journal vide ; rejouer la sortie encore active conserve son journal. L’historique commence à l’ajout de la fonctionnalité : aucune ancienne position n’est inventée.

Chaque entrée propose « Suivre ce point » si le module GPS est actif. `pointTracking.open(provider)` reçoit uniquement les coordonnées, le type et l’identité du point enregistré. Un changement de saisie ou de zone ne déplace pas ce point. Le résultat courant continue d’utiliser son propre fournisseur, avec invalidation à chaque nouvelle réception. La trace GPS reste temporaire : seul le point choisi appartient au journal.

Les entrées sont rendues au dépliage et après sauvegarde, sans recalcul cryptographique ni appel réseau. La taille du journal est bornée à 300 000 caractères pour laisser de la place aux autres données locales ; si cette limite est atteinte, un message explique que le nouveau point n’a pas été enregistré, sans supprimer les anciens. Un journal illisible est conservé sans écrasement. Les trois fichiers sont inclus dans la publication et son cache hors connexion. PROTO et COMPAT restent inchangés.

Tests sans génération : `node --test tests/position-history-model.test.cjs tests/position-history.test.cjs`, également inclus dans la suite des sources. Ils couvrent le tri, la validation, les erreurs radio, les doublons de confirmation, les deux types de suivi, le changement de zone, la reprise hors réseau le rejeu de la sortie active, la recréation d’une ancienne sortie, le nettoyage des archives héritées et la restauration complète en cas d’échec de la transaction.

## Une seule sortie locale

`writeActive()` enregistre la nouvelle sortie et efface les autres clés `outing:` dans une transaction IndexedDB unique. Création et import suivent la même règle ; un refus, une annulation, une révision concurrente ou un échec de transaction conserve la sortie précédente. Il reste uniquement `active` et la copie `outing:<id actif>`, qui décrivent la même sortie. Le journal, les secrets et les réglages des anciennes sorties ne sont plus archivés.

`retainActiveOuting()` nettoie les archives laissées par les versions précédentes au démarrage du launcher et de la nouvelle publication, sans modifier la sortie active ni sa révision. Un rejeu de l’invitation active conserve ses données ; les anciennes invitations recréent une sortie sans journal, à condition de pouvoir charger leur publication. Les publications déjà diffusées conservent leur ancien code jusqu’au passage à la nouvelle version ; le launcher nettoie aussi leurs archives lors de son ouverture. Le nettoyage des caches de fichiers reste indépendant et protège les publications encore ouvertes.

## Rejeu d’une invitation sans réseau

Le launcher distingue les données privées de sortie et les fichiers publics de release. `download()` utilise d’abord le manifeste connu de la sortie active, puis cherche le manifeste dans le cache de la release exacte portée par l’invitation. Il vérifie son empreinte ainsi que tous les fichiers avant de charger l’application, même si les données d’une ancienne sortie ont été supprimées ou si cette invitation n’a jamais été installée. Une copie complète évite toute demande de téléchargement. Un cache absent, incomplet ou altéré exige une réparation en ligne ; aucune autre release n’est utilisée comme remplacement. Les contrôles d’invitation et la confirmation d’installation restent obligatoires.

Tests : rejeu hors réseau d’une ancienne sortie supprimée avec une release encore présente ; copie complète sans manifeste de sortie connu ; manifeste ou moteur altéré ; absence de cache ; réparation en ligne sans perte de la sortie active. La création d’une nouvelle sortie reste soumise à la connexion pour choisir la dernière publication. La suppression manuelle d’une sortie efface ses données privées, mais conserve la copie de sa release si elle est encore au catalogue, pour pouvoir rejouer son invitation hors réseau. Une copie dont le retrait a déjà été confirmé peut être nettoyée dès cette suppression. Après installation réussie d'une autre sortie, les moteurs encore au catalogue sont conservés ; seuls les moteurs dont le retrait a été confirmé deviennent éligibles au nettoyage, sans toucher à une autre page ouverte ou à une préparation. Une invitation visant un moteur effectivement retiré du téléphone exige de pouvoir le retélécharger. Le reset complet supprime également les caches de releases. Le test « suppression manuelle hors réseau » vérifie explicitement ce parcours.

## Conservation des moteurs selon le catalogue

Le service worker utilise uniquement le catalogue releases.json de son accueil installé,
vérifié par son empreinte SHA-256 et contrôlé avant activation. Un téléchargement incomplet,
un catalogue incohérent ou un cache altéré n'autorise aucun nouveau retrait. Le téléphone
ne télécharge pas tous les moteurs du catalogue : il conserve seulement les copies déjà
présentes et continue de vérifier tous les fichiers avant un rejeu.

La clé publique release-catalog du cache de contrôle contient la version du worker et les
identifiants des publications déjà reconnues. Une copie n'est supprimable que si elle a été
reconnue dans un catalogue puis absente du catalogue installé actuel. Une publication
encore inconnue peut être plus récente que l'accueil ; son absence seule ne prouve pas son
retrait. Lors de la première adoption du mécanisme, les copies anciennes jamais reconnues
restent donc conservées par prudence. Cette liste ne contient ni secret, ni invitation, ni
journal. Un travail de nettoyage d'un worker remplacé n'a plus autorité pour supprimer.

Le nettoyage se déclenche après activation d'un nouvel accueil vérifié, installation
sauvegardée d'une sortie (créée ou importée) et suppression manuelle de la sortie active.
Il protège toujours le moteur actif, toutes les pages de publication ouvertes et les
préparations réservées. Le chargement depuis le cache réserve aussi son moteur, sans
requête réseau, avant la vérification des fichiers. Réservations et nettoyage sont
sérialisés dans le worker ; la nouvelle réservation est confirmée avant le chargement.
Une copie retirée mais protégée sera nettoyée lors d'un prochain nettoyage une fois
ces protections levées. Un retrait ne remplace jamais un moteur par une autre version.

Les anciens secrets, réglages et journaux continuent d'être supprimés atomiquement lors
du remplacement de la sortie. La conservation de moteurs publics ne rétablit pas des
archives privées. Une purge ordinaire reste distincte d'un reset complet explicite.

Tests : moteurs catalogués conservés sans préchargement ; reprise et rejeu hors réseau ;
purge avec sortie active, autre page ou téléchargement ; préparation en cache réservée ;
moteur plus récent qu'un ancien catalogue ; catalogue altéré ou mise à jour interrompue ;
nettoyage après levée des protections ; reset complet inchangé.
