# VHF GPS — distribution par publication

La racine du dépôt contient l’application distribuée. La version publiée est indiquée
dans RELEASES.html ; le moteur actuel utilise PROTO 6 / COMPAT 4043F648. L’interface et les invitations utilisent les libellés
de l’application finale. Les anciennes sources à la racine ont été remplacées.
Aucun commit ni push automatique.

L’icône radio et carte marine choisie est intégrée pour Android et iPhone.
Sa source et ses exports sont décrits dans [icons/README.md](icons/README.md).
Les icônes adaptatives déclarées dans le manifeste font partie du cache du launcher.

Pour les opérations courantes, lire [DEVELOPPEMENT.md](DEVELOPPEMENT.md).
Une release seule conserve les anciennes publications. « Release + purge » suit une règle
de conservation sans reset des téléphones. « Release + reset complet » est une opération
distincte qui exige une demande explicite ; les effets sont détaillés dans ce guide.
Double-cliquer sur **PUBLICATIONS.cmd** ouvre le menu local de préparation,
vérification, affichage et purge des publications. Il utilise Node.js et ne publie rien à ta place.

## Publier

Le dépôt à sa racine contient l’application distribuable et ses icônes.
La génération utilise uniquement les fichiers de ce dépôt.
Adresse : https://julienbranco.github.io/VHF-GPS-Code/
L’icône installée s’appelle VHF GPS. L’accueil présente le bouton d’installation et les étapes adaptées au téléphone.

Les invitations de l’ancienne application monolithique ne sont pas compatibles.
L’ancienne adresse vhf_gps_code.html permet de retrouver l’accueil ; aucune ancienne
session n’est importée. Le nouveau worker débloque aussi une ancienne page restée en cache,
sans demander plusieurs désinstallations. Les testeurs peuvent ensuite réinstaller la nouvelle icône.

## Où modifier quoi

- sources/app.html : interface de l’application.
- sources/engine.js : moteur actif (catalogues, crypto, zones, échange).
- sources/app-adapter.js : démarrage, préparation/import et partage de sortie.
- sources/runtime.js : sauvegarde, reprise et navigation en pleine page.
- sources/point-tracking.js, point-tracking-math.js et point-tracking.css : suivi GPS facultatif du point confirmé, isolé du moteur radio.
- transition.js / transition.css : chargement commun et retour à la position de lecture.
- install.js : bouton d’installation et instructions dans le launcher.
- boot.js : ouverture de la bonne publication, création et réception initiales.
- protocol.js, storage.js, release.js : invitation compacte, transactions, téléchargement.
- releases/ : fichiers générés à publier. Ne pas les éditer à la main.

Le générateur copie ces sources et calcule leurs empreintes. Il ne découpe plus le HTML
original, ne remplace plus localStorage et ne redéfinit plus les fonctions au démarrage.
L’application distribuée possède explicitement appStorage et ses fonctions de démarrage.
Les sources de ce dossier sont l’unique base de développement de l’application.
Pendant les retouches, utiliser l’aperçu local ci-dessous. Générer et vérifier une publication seulement quand elle est prête à être diffusée.

## Aperçu local sans génération

Lancer `node tools/live-server.cjs 8083` et ouvrir http://127.0.0.1:8083/.
La première fois, préparer une sortie dans cet aperçu. Ensuite, garder la page de cette
sortie ouverte : modifier un fichier de `sources/` et recharger suffit pour voir la
nouvelle interface ou le nouveau moteur. La sortie locale reste disponible sur ce port.
Aucun dossier `releases/`, manifeste ni catalogue n’est créé par cet aperçu.

Le port 8083 possède son propre stockage de navigateur. Cet aperçu utilise un identifiant
de publication fictif, sert les fichiers directement depuis les sources et n’est pas prévu
pour vérifier le hors-ligne, la distribution ou partager une invitation réelle.
Le bandeau « APERÇU LOCAL » le rappelle à l’écran. Avant diffusion, utiliser le générateur
et les tests ci-dessous ; les invitations de l’aperçu ne doivent pas être envoyées.

## Catalogue des publications

Ouvrir RELEASES.html (même par double-clic) pour voir la dernière publication,
la version, le protocole et la date de chaque release. releases.json conserve
les métadonnées. Le build les actualise automatiquement, sans commande supplémentaire.
Les dates de création restent stables lors des reconstructions. Les publications plus anciennes
affichent une date de référencement distincte, car leur date de création est inconnue.
Conserver releases.json avec le projet ; ne pas modifier les dates à la main.
Le catalogue ne supprime aucun fichier et ne sait pas quelles sorties sont encore utilisées.

## Accueil

L’adresse de base et l’icône installée ouvrent un accueil, sans redirection automatique.
Le bouton Reprendre présente la zone active et la date de création, puis recharge
la publication exacte de la sortie. Préparer une nouvelle sortie consulte latest.json
en ligne ; Recevoir suit la publication de l’invitation. Annuler la saisie d’une invitation (bouton ou Échap) revient à cet accueil, sans
reprendre automatiquement la sortie. Une création annulée revient à la sortie
précédente et à sa position de lecture. Les sorties sans résumé affichent Sortie enregistrée ; leur date est lue depuis leur état.

Une nouvelle version de l’accueil est téléchargée et vérifiée entièrement avant activation.
L’accueil s’actualise automatiquement quand aucune préparation ni installation n’est en cours ;
le texte collé et la fenêtre de réception sont conservés. Ses fichiers restent ceux d’un même
accueil jusqu’à son actualisation, même si le worker a déjà changé.
Les pages de sortie ne sont pas rechargées : leur publication et leurs saisies restent inchangées.
La vérification a lieu à l’ouverture, au retour du réseau, au retour au premier plan et toutes
les cinq minutes pendant l’utilisation. En arrière-plan, le système peut suspendre JavaScript.

Le lanceur propose directement Reprendre, Préparer une nouvelle sortie et Recevoir une invitation.
Dans l’application, deux boutons compacts sont placés en haut : Accueil revient
au lanceur après sauvegarde ; Partager ouvre la modale dans la page actuelle,
sans navigation et sans perdre les saisies ni les résultats radio. Le partage est
visible uniquement si la session, la zone d’origine et sa confirmation le permettent.
Les modales de création et de contrôle d’import restent dans leur publication.

## Conservation des versions

Une publication regroupe tous les fichiers utilisés par la sortie, y compris les modules
de sauvegarde et de chargement de cette publication. Son identifiant est l’empreinte du
manifeste. Le panneau « Informations techniques » affiche la version et huit caractères de cet identifiant.
Une sortie mémorise cet identifiant. Elle recharge les mêmes fichiers après fermeture,
même si le lanceur a été mis à jour. Les empreintes de chaque fichier sont vérifiées.

Il n’y a plus d’iframe ni de dialogue entre deux pages ouvertes simultanément.
Le lanceur navigue vers la page de la publication. La préparation reste temporaire dans
sessionStorage jusqu’à la confirmation ; la sortie précédente reste durablement active.
La transaction remplace ensemble la référence active, l’invitation et toutes ses données.
Une fermeture avant confirmation ne remplace donc pas la sortie précédente.

Les publications antérieures ont été purgées lors de la remise à zéro.
Après diffusion d’une invitation, garder les fichiers de sa publication sur le serveur.
Le générateur conserve les publications et refuse de modifier leurs fichiers existants.
Il refuse aussi une publication référencée dont le dossier ou un fichier manque :
une suppression volontaire passe par le menu de **PUBLICATIONS.cmd**.
Le menu simule les suppressions, demande une confirmation explicite et synchronise
les métadonnées. Il conserve toujours la publication actuelle et dispose d’un journal
de restauration si une purge est interrompue.
Une purge ordinaire retire seulement les fichiers du serveur. Le choix de remise à zéro
complète change aussi un marqueur dans releases.json : les téléphones qui téléchargent cet
accueil abandonnent alors les sorties et copies de publications précédentes, une seule fois.
Cette opération est volontaire ; une publication ordinaire conserve ce marqueur.
Après chaque nouvelle sortie sauvegardée, créée ou importée, le téléphone retire les copies
de publications inutiles. La sortie active, les pages encore ouvertes et les téléchargements
en cours sont protégés. Le nettoyage ne commence pas avant la confirmation et la sauvegarde.
Il n’exécute aucune commande Git et ne demande aucune automatisation GitHub.

## Invitations et sauvegardes

L’invitation se colle dans la fenêtre de réception de l’accueil. La publication indiquée
par cette invitation effectue ensuite ses contrôles automatiquement et affiche un résumé
dans la modale « Confirmer la sortie reçue », sans champ de texte modifiable.
La sortie active ne change qu’après confirmation et sauvegarde. Pour vérifier une autre
invitation, annuler et repasser par la réception de l’accueil.

Le code partagé contient l’identifiant de publication et le code de sortie du moteur,
sans réencoder le message complet. Le résumé lisible figure une seule fois. Le contrôle
d’intégrité lie ce résumé au code ; le moteur recalcule ensuite PROTO, COMPAT et alias.
Le résumé tolère les accents Unicode équivalents (NFC), les retours CR/LF et les espaces
insécables. La casse et les accents restent significatifs : aucune correction de mot
n’est devinée. Le code n’est pas normalisé. Les anciennes invitations avec leur contrôle
exact restent lisibles ; rejouer une présentation équivalente conserve la même sortie.
Ce contrôle détecte les altérations accidentelles ; il n’authentifie pas l’expéditeur.
Une invitation contient le secret : la partager seulement avec les participants.

Création et import attendent la transaction avant le message de succès.
La confirmation d’alias à la radio prépare ses nouvelles données, bloque temporairement
les interactions, attend la sauvegarde, puis rend la zone confirmée et utilisable.
Un échec de sauvegarde bloque la page ; elle ne présente pas de fausse confirmation.
Les autres réglages sont enregistrés dès la prochaine microtâche, sans délai de 40 ms.
Leur écriture reste asynchrone : un arrêt avant son achèvement peut perdre le dernier réglage.
Les échanges et les positions en cours ne sont pas restaurés.

Une autre fenêtre qui modifie l’état bloque l’ancienne vue. Les transactions utilisent
une révision pour empêcher une préparation devenue obsolète d’écraser la sortie actuelle.
La création consulte latest.json en ligne. L’import suit exactement la publication du
message ; une invitation déjà installée peut être rejouée sans réseau si son cache est complet.
Une première importation demande Internet. Un cache incomplet impose une réparation
avec l’invitation ; aucune autre publication ne remplace silencieusement la sortie.

Pour une nouvelle sortie, le type « zone intégrée » est proposé, mais aucune zone précise n’est présélectionnée. Il faut choisir explicitement dans la liste avant de vérifier la sortie. Cette règle évite le repli implicite vers IROISE / BREST, même lorsque la précédente sortie était éphémère.

Depuis l’accueil, « Supprimer la sortie active » demande une confirmation. La transaction efface la sortie active et sa copie enregistrée (session, invitation et réglages). Elle conserve seulement une révision sans secret pour bloquer les écritures d’un ancien onglet. Les fichiers de publication en cache restent disponibles ; retrouver la sortie exige son invitation conservée.

## Limites de l’application

Le navigateur peut évincer les données locales. L’application ne peut pas garantir leur
conservation après un effacement par l’utilisateur ou le système.
Les zones personnalisées restent propres à chaque sortie ; pas de catalogue personnel
global ajouté. Il n’y a plus de réglage manuel du secret dans l’interface ; la session
est préparée ou installée avec une invitation.
Les modules partagent l’origine Web : cette isolation fonctionnelle du stockage n’est pas
une frontière de sécurité contre un script malveillant de la même origine.
Les corrections du cycle de mise à jour doivent être revalidées sur de vrais téléphones
Android et iPhone. Les tests Chromium sur PC ne valident pas les comportements natifs d’iOS.

## Construire et vérifier

Utiliser Node.js 22 ou plus récent. Pour préparer les fichiers sans les tests navigateur :

    node tools/build.cjs
    node tools/build.cjs --check

La première fois sur un PC, puis après un changement des dépendances verrouillées :

    npm ci
    npm run test:install

`package.json` déclare Playwright comme dépendance de développement ; `package-lock.json`
fixe les versions et leurs empreintes. Le navigateur Chromium est installé par Playwright.
Aucun chemin Codex ou Chrome Windows n’est utilisé par défaut. L’installation initiale demande
Internet ; la suite utilise ensuite uniquement les serveurs locaux et les fichiers du projet.
Sur Linux, des bibliothèques système peuvent aussi être nécessaires : `npx playwright install --with-deps chromium`.
La [documentation Playwright](https://playwright.dev/docs/browsers) décrit les plateformes prises en charge.

Pour exécuter la suite complète :

    npm test

Cette commande vérifie d’abord les fichiers publiables avec `build.cjs --check`, sans les modifier,
puis exécute toutes les suites. Si les sources ont changé, préparer la publication avant de valider
sa distribution. Pour les retouches locales, `npm run test:unit` exécute les suites sans
navigateur et sans exiger une publication synchronisée. `npm run test:browser` exécute les
suites navigateur, précédées de la vérification de la publication.

Pour tester les sources sans créer de release, lancer `npm run test:sources`.
Les tests de navigateur préparent leurs publications en mémoire et ne modifient pas releases/.

Option avancée : `VHF_CHROME` peut désigner explicitement un autre exécutable Chrome/Chromium.
Cela remplace le navigateur verrouillé pour un essai particulier ; laisser cette variable absente
pour la validation reproductible normale.

`node_modules/` et les résultats de test sont exclus de Git. Conserver `package.json` et
`package-lock.json` avec le projet. Les tests de génération et de purge utilisent des dossiers
temporaires : ils ne créent ni ne suppriment de publication du projet.
Playwright et Chromium servent uniquement aux tests sur ordinateur ; les téléphones n’ont besoin
ni de Node ni de ces dépendances. Ces changements d’outillage ne demandent aucune nouvelle release.
Le serveur local est tools/server.cjs : lancer `node tools/server.cjs 8082`, puis ouvrir http://127.0.0.1:8082/.

## Vérification du cycle de mise à jour

Les tests couvrent la reprise depuis le vrai worker 3.28.102 sous le chemin GitHub Pages,
l’actualisation automatique d’un simple onglet avec invitation collée, la mise à jour pendant
une préparation et pendant une sortie, puis la réouverture hors réseau.
Une publication serveur incohérente est refusée sans perdre l’accueil précédent.
La remise à zéro explicite, le refus des écritures obsolètes et le nettoyage des copies
inutiles sont vérifiés, avec protection de la sortie active et des autres pages ouvertes.
Les suites vérifient aussi l’échange radio complet, chaque zone intégrée, les invitations,
la sauvegarde durable des confirmations et les erreurs de téléchargement.
Le GPS et le partage simulés ne valident pas les permissions et dialogues natifs du téléphone.

Les cinq contrôles des catalogues PROTO 6 sont adaptés à la source actuelle. Les anciens tests liés aux écrans et au stockage monolithiques ne sont pas repris tels quels ; la suite Chrome couvre le parcours actuel et vérifie aussi chaque zone intégrée.

Le démarrage vérifie l’activation de son inscription de service worker, même si Ctrl+F5
a temporairement contourné son contrôle de la page. Une actualisation de l’accueil ne remplace jamais la publication d’une sortie, sauf remise à zéro complète explicite.
Un double-clic sur index.html affiche une explication : l’application doit être servie via
localhost (PC) ou HTTPS (GitHub Pages), et non ouvert comme fichier.
Les deux cas font l’objet de tests navigateur dédiés, dont un vrai rechargement
Chrome avec ignoreCache, puis reprise sous le contrôle du service worker.

Le lanceur et la publication masquent leur contenu pendant le démarrage, jusqu’à la
modale prête ou la reprise terminée. L’adresse change encore pour charger la publication.
Une annulation retrouve la position de lecture de la sortie précédente, dans le même onglet.
Le bouton Installer et les instructions d’installation sont réunis dans le lanceur. Dans le
navigateur, le bouton lance la proposition native si elle a été reçue, sinon affiche les instructions.
Il est masqué dans une fenêtre standalone ou après appinstalled dans cette page.
Cela ne constitue pas une détection universelle des installations depuis un navigateur.
Les tests simulent la proposition native et le mode standalone ; les dialogues réels
et l’installation iPhone restent à vérifier sur appareil.
La préparation d’une publication conserve les précédentes. Leur suppression est volontaire
et passe par le menu de purge ; elle peut empêcher le téléchargement d’anciennes invitations.
