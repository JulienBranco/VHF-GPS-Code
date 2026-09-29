# VHF GPS — distribution par publication

La racine du dépôt contient désormais l’application distribuée V3.28.106,
PROTO 6 / COMPAT 4043F648. L’interface et les invitations utilisent les libellés
de l’application finale. Les anciennes sources à la racine ont été remplacées.
Aucun commit ni push automatique.

## Publier

Le dépôt à sa racine contient l’application distribuable et ses icônes.
La génération utilise uniquement les fichiers de ce dépôt.
Adresse : https://julienbranco.github.io/VHF-GPS-Code/
L’icône installée s’appelle VHF GPS. Le bouton Guide explique l’utilisation.

La remise à zéro du 29 septembre conserve une seule publication et utilise une
nouvelle base locale. Les invitations de l’ancienne application ne sont pas compatibles.
Les anciennes icônes installées ne sont pas prises en charge : demander aux testeurs
de les désinstaller et de réinstaller l’application depuis la nouvelle adresse avec du réseau.
Le nouveau service worker supprime les anciens caches. Les anciennes données du navigateur
ne sont pas effacées, mais ne sont pas reprises dans la nouvelle sortie.
Après une première diffusion réelle, conserver les publications distribuées.

## Où modifier quoi

- sources/app.html : interface de l’application.
- sources/engine.js : moteur actif (catalogues, crypto, zones, échange).
- sources/app-adapter.js : démarrage, préparation/import et partage de sortie.
- sources/runtime.js : sauvegarde, reprise et navigation en pleine page.
- transition.js / transition.css : chargement commun et retour à la position de lecture.
- install.js : bouton d’installation et instructions en repli dans les deux pages.
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

Le lanceur propose Reprendre et un panneau Préparer ou recevoir une sortie.
Dans l’application, deux boutons compacts sont placés en haut : Accueil revient
au lanceur après sauvegarde ; Partager ouvre la modale dans la page actuelle,
sans navigation et sans perdre les saisies ni les résultats radio. Le partage est
visible uniquement si la session, la zone d’origine et sa confirmation le permettent.
Les modales de création et de contrôle d’import restent dans leur publication.

## Conservation des versions

Une publication regroupe tous les fichiers utilisés par la sortie, y compris les modules
de sauvegarde et de chargement de cette publication. Son identifiant est l’empreinte du
manifeste. Le bandeau affiche aussi version et huit caractères de cet identifiant.
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
Il n’exécute aucune commande Git et ne demande aucune automatisation GitHub.

## Invitations et sauvegardes

La modale de validation affiche le même message public que le champ de réception.
Effacer puis recoller ce message permet de refaire ses contrôles. Une invitation
différente doit repasser par l’accueil pour sélectionner sa propre publication ;
elle ne peut pas remplacer silencieusement celle déjà en vérification.

Le code partagé contient l’identifiant de publication et le code de sortie du moteur,
sans réencoder le message complet. Le résumé lisible figure une seule fois. Le contrôle
d’intégrité lie ce résumé au code ; le moteur recalcule ensuite PROTO, COMPAT et alias.
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

## Limites de l’application

Le navigateur peut évincer les données locales. L’application ne peut pas garantir leur
conservation après un effacement par l’utilisateur ou le système.
Les zones personnalisées restent propres à chaque sortie ; pas de catalogue personnel
global ajouté. Le secret manuel est en lecture seule dans cette architecture.
Les modules partagent l’origine Web : cette isolation fonctionnelle du stockage n’est pas
une frontière de sécurité contre un script malveillant de la même origine.
Le téléphone Android réel doit être testé ; iPhone reste à valider sur un appareil réel.

## Construire et vérifier

Node.js suffit :

    node tools/build.cjs
    node tools/build.cjs --check
    node --test tests/integration.test.cjs
    node --test tests/release-catalog.test.cjs
    node --test tests/live-preview.test.cjs
    node --test tests/catalog-proto6.test.cjs

Les fichiers publiables sont déjà construits. Playwright et Chrome servent uniquement
aux tests sur ordinateur ; les téléphones n’ont besoin ni de Node ni des fichiers du projet.
Le serveur local est tools/server.cjs : lancer `node tools/server.cjs 8082`, puis ouvrir http://127.0.0.1:8082/.

## Vérification du 29 septembre 2026

Les 3 contrôles du catalogue passent : dates stables à la reconstruction, nouvelle
publication répertoriée sans altérer les anciennes, date inconnue pour les anciens
essais et refus d’un catalogue obsolète ou d’un manifeste altéré.

34 tests d’intégration Chrome passent : échange radio complet, COMPAT et alias identiques,
zones éphémères, isolation des anciennes données locales, copie, GPS simulé, partage natif simulé,
mobile 390 px, reprises hors réseau, cache absent/réparation, écritures abandonnées,
fenêtres concurrentes, altération du code ou du résumé, nouvelle publication disponible,
confirmation radio avant/après acquittement et échec de sa sauvegarde.
Un nouveau lanceur est installé en attente, puis Chrome entièrement fermé et rouvert
hors réseau : la publication et la session restent celles de la sortie. Le même test
vérifie que le cache d’une publication plus ancienne n’est pas supprimé.
Le GPS et le partage simulés ne valident pas les permissions et dialogues natifs du téléphone.

Les cinq contrôles des catalogues PROTO 6 sont adaptés à la source actuelle. Les anciens tests liés aux écrans et au stockage monolithiques ne sont pas repris tels quels ; la suite Chrome couvre le parcours actuel et vérifie aussi chaque zone intégrée.

Le démarrage vérifie l’activation de son inscription de service worker, même si Ctrl+F5
a temporairement contourné son contrôle de la page. Il ne force aucune mise à jour.
Un double-clic sur index.html affiche une explication : l’application doit être servie via
localhost (PC) ou HTTPS (GitHub Pages), et non ouvert comme fichier.
Les deux cas font l’objet de tests navigateur dédiés, dont un vrai rechargement
Chrome avec ignoreCache et controller null avant la reprise.

Le lanceur et la publication masquent leur contenu pendant le démarrage, jusqu’à la
modale prête ou la reprise terminée. L’adresse change encore pour charger la publication.
Une annulation retrouve la position de lecture de la sortie précédente, dans le même onglet.
Le bouton Installer reste disponible dans le navigateur, indépendamment de la proposition
native. Il lance cette proposition si elle a été reçue, sinon affiche les instructions.
Il est masqué dans une fenêtre standalone ou après appinstalled dans cette page.
Cela ne constitue pas une détection universelle des installations depuis un navigateur.
Les tests simulent la proposition native et le mode standalone ; les dialogues réels
et l’installation iPhone restent à vérifier sur appareil.
Les publications déjà utilisées pour une sortie restent conservées.
