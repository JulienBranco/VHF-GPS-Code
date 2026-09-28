# Cohérence des sorties, échanges radio et distribution

Analyse du 28 septembre 2026 — application V3.28.101, PROTO 6, COMPAT `4043F648`.

Ce document est une proposition issue de l'examen du code actuel. Les pistes discutées auparavant ne sont pas considérées comme des décisions acquises. Aucun changement du fonctionnement de l'application n'a été réalisé pour cette analyse.

## Conclusion proposée

Conserver la PWA et le protocole radio actuel. Ajouter une gestion explicite de la sortie et de la publication logicielle qui l'exécute. Une sortie validée doit désigner une publication complète, immuable et disponible localement. Une nouvelle publication ne remplace pas celle d'une sortie existante.

Cette proposition répond aux fermetures et réouvertures en mer sans demander au moteur courant d'interpréter les anciens protocoles. Elle demande cependant un véritable changement du démarrage, du stockage et de la publication. Ce n'est pas une correction de quelques lignes du service worker.

La cohérence radio ne nécessite pas intrinsèquement une interface identique : un logiciel corrigé peut communiquer avec un logiciel plus ancien s'ils appliquent réellement les mêmes règles. Le choix d'une publication complète par sortie est ici une simplification d'exploitation, compte tenu des évolutions fréquentes de l'interface, des catalogues et du moteur. Il doit être confirmé par un prototype avant intégration.

## Besoins retenus et limites de ce que l'on peut garantir

- Préparer et accepter une sortie avec le parcours actuel, sans comparaison technique de versions ni fermeture manuelle de l'application.
- Continuer une sortie sans connexion, y compris après la destruction de la page par le système et son redémarrage depuis l'icône.
- Préparer une nouvelle sortie avec une vérification en ligne de la publication recommandée. Si ce contrôle échoue, conserver la sortie existante et refuser cette nouvelle préparation.
- Permettre le rejeu d'une invitation pour restaurer sa configuration. Hors connexion, cette restauration suppose que sa publication et les données nécessaires sont encore présentes sur ce téléphone.
- Accepter une préparation anticipée : le délai de 48 heures évoqué ne doit pas être réduit arbitrairement à 12 heures. Aucune expiration bloquante n'est nécessaire pour la solution proposée.
- Garder les coordonnées et les secrets sur les appareils et dans les messages volontairement partagés. Le téléchargement d'une publication ne doit transmettre que son identifiant public.

« Dernière version » doit signifier « dernière publication annoncée par le contrôle réseau réussi au début de la préparation ». Une publication peut survenir juste après ce contrôle et les différentes caches réseau peuvent se mettre à jour à des instants différents. Une promesse de dernière version mondiale à chaque instant ne serait pas honnête. La cohérence du groupe doit donc reposer sur la publication désignée par l'invitation, pas sur des contrôles de dernière version effectués séparément par chaque participant.

L'application ne peut pas savoir hors connexion si tous les pêcheurs ont accepté la même invitation ou si une personne utilise un autre téléphone. Elle peut garantir la cohérence de chaque installation acceptée et conserver la vérification radio de chaque échange. La confirmation d'une invitation ne prouve pas l'identité de son expéditeur : le modèle reste celui du partage entre personnes de confiance.

## Constats dans le code actuel

### Protections utiles déjà présentes

- L'invitation porte le PROTO, le COMPAT complet, un identifiant de sortie, le secret, la date et la description de zone.
- L'import contrôle l'intégrité du bloc et recalcule l'empreinte de session ainsi que l'alias de zone. Un PROTO ou COMPAT différent est refusé.
- La zone éphémère est reconstruite à partir de l'ancre et du secret ; un centre local incohérent est corrigé à l'import.
- Le changement manuel de zone demande une confirmation, invalide les résultats et impose une nouvelle confirmation de l'alias.
- Un autotest connu conditionne l'utilisation du protocole. La génération d'un message est contrôlée par décodage inverse.
- Le décodage radio vérifie un tag de 9 bits. La position n'est marquée confirmée qu'après sélection du mot final attendu. Le mot de retour côté émetteur doit toujours être comparé par la personne qui écoute.
- Plusieurs calculs asynchrones sont déjà protégés par des révisions, notamment les empreintes de session et les listes d'alias.

Ces mécanismes constituent une base à conserver. Le contrôle local de 9 bits n'est pas une preuve absolue : son espace ne contient que 512 valeurs. Le mot de retour et le mot final restent nécessaires. La probabilité d'une erreur sur l'échange complet n'a pas été évaluée dans cette analyse ; il serait incorrect de multiplier naïvement des probabilités et d'en déduire une garantie terrain. Une confirmation ne prouve pas non plus que les coordonnées initialement saisies étaient celles que l'émetteur voulait communiquer.

Le protocole est déterministe pour une position, une zone et une session données. Il ne fournit pas une preuve de fraîcheur d'un message radio ancien rejoué dans ce même contexte. Ce sujet est distinct du rejeu volontaire d'une invitation et des mises à jour. Aucun changement de protocole n'est proposé ici pour le traiter.

### Lacunes confirmées

| Constat | Conséquence | Emplacement |
|---|---|---|
| La session sauvegardée ne contient pas son COMPAT d'origine ni une publication logicielle de référence. | Le démarrage reprend le secret avec le moteur présent, même après changement de protocole. | `initSessionSecret`, `installValidatedSecret`, vers les lignes 6497–6569 |
| Le service worker supprime les anciens caches à son activation. | Une fermeture suivie d'une réouverture peut rendre indisponible le logiciel utilisé lors de la préparation. | `sw.js`, lignes 32–40 |
| Le statut hors réseau recherche le HTML dans tous les caches et vérifie l'existence d'un worker actif. | Il n'identifie pas précisément la publication qui sera servie au prochain démarrage et ne revérifie pas tous ses fichiers. | `initPwa`, lignes 3200–3210 |
| La confirmation de zone sauvegardée dépend du PROTO et du secret, mais pas du COMPAT ni de la géométrie confirmée. | À PROTO constant, une évolution incompatible peut laisser subsister une confirmation devenue obsolète. | `confirmationSessionKey`, `loadZoneConfirmations`, vers les lignes 4317–4352 |
| La génération du message ne revalide pas son contexte après ses calculs asynchrones. | Un ancien résultat peut réapparaître après changement de session, de zone ou de position. Le cas session a été reproduit. | `encodeSelectedPosition`, vers les lignes 5850–5897 |
| L'import écrit plusieurs éléments de la nouvelle session avant la fin de ses opérations. | Un échec intermédiaire ne restaure pas automatiquement l'état précédent. | `installOutingInvitation`, vers les lignes 6898–6943 |
| Les données utilisent des clés communes, sans coordination explicite des différentes fenêtres. | Deux fenêtres ou deux publications partageant le stockage peuvent garder des états en mémoire différents ou écrire des données incompatibles. | Stockage et initialisation de la session |

Le dernier point est un risque identifié par lecture, pas un défaut reproduit sur deux navigateurs dans cette analyse. De même, le faux sentiment de disponibilité hors réseau découle du contrôle incomplet ; aucune éviction réelle de cache sur iPhone n'a été provoquée.

### Vérifications effectuées

Les trois suites existantes ont été exécutées : **61 tests réussis, 0 échec**. Elles testent le script réel dans un DOM simulé et un service worker simulé ; elles ne remplacent pas des essais de cycle de vie sur téléphone.

Trois expériences supplémentaires ont été exécutées en mémoire, sans modifier les fichiers de l'application :

1. Suspendre l'encodage, changer la session, puis laisser finir le calcul. Le bloc masqué au changement de session réapparaît avec l'ancienne transmission.
2. Provoquer un échec du calcul d'empreinte après les premières écritures de l'import. L'import échoue, mais l'ancien secret actif et l'ancien identifiant de sortie ne sont pas conservés.
3. Charger une variante de protocole simulée, avec son vecteur d'autotest recalculé, sur le stockage d'une sortie existante. L'autotest passe et le secret précédent devient actif dans le nouveau protocole. Cette expérience isole le comportement de restauration ; elle ne correspond pas à une publication réelle de PROTO 7.

## Comparaison des directions possibles

| Direction | Apport | Limite déterminante |
|---|---|---|
| Ajouter un bouton ou des contrôles fréquents de mise à jour | Réduit le nombre d'applications anciennes lors des préparations | Ne conserve pas le moteur d'une sortie après une mise à jour |
| Vérifier la dernière version à la création et à l'import | Écarte certaines installations anciennes | Une publication entre les deux contrôles peut rendre l'invitation incompatible ; ne protège pas le redémarrage en mer |
| Maintenir le protocole actuel et le précédent | Permet à un moteur récent de continuer certaines anciennes sorties | Nécessite de versionner tous les paramètres et parfois les algorithmes ; deux versions ne suffisent qu'avec des bornes d'usage et de publication réellement imposées |
| Publication complète figée par sortie | Conserve ensemble moteur, catalogues, géométrie et interface ; survit aux redémarrages tant que le stockage existe | Demande un mécanisme de lancement, un stockage isolé et l'archivage des publications |
| Application native distribuée par un store | Autre gestion de l'installation et du stockage | Ne synchronise pas les mises à jour entre pêcheurs ; ne dispense pas de gérer les compatibilités et les données |
| Séparer une diffusion de test et une diffusion stable | Réduit l'exposition aux changements fréquents | Bonne discipline de publication, mais ne résout pas seule la continuité d'une sortie |

Je recommande la publication figée par sortie pour ce projet, car elle satisfait les besoins sans faire dépendre la sûreté d'un calendrier de publication ou de la durée supposée des sorties. La séparation test/stable reste complémentaire. Le choix n'est pas motivé par une validation antérieure du brainstorm.

## Fonctionnement proposé pour les pêcheurs

### Préparer une nouvelle sortie

Le bouton habituel déclenche le contrôle réseau et, si nécessaire, le téléchargement automatique de la publication recommandée. Le brouillon s'ouvre dans cette publication. La sortie précédente reste restaurable jusqu'à la confirmation complète de la nouvelle.

Un changement de publication pendant la préparation ne doit ni faire perdre le brouillon ni lancer une boucle de mises à jour. La publication a été choisie au contrôle initial ; l'invitation désigne ensuite cette référence exacte.

La confirmation finale n'est possible qu'après vérification des fichiers locaux, de l'autotest, du secret et de la zone. L'invitation ne devient partageable qu'après l'enregistrement complet de la sortie.

### Recevoir une invitation

Le pêcheur colle le message comme aujourd'hui. L'application lit une enveloppe commune, identifie la publication requise, la récupère si nécessaire, puis lui confie les contrôles détaillés déjà présents. Elle affiche ensuite le résumé actuel et demande la confirmation habituelle.

Le receveur prend **la publication de l'invitation**, même si une autre est plus récente. C'est une différence explicite avec l'idée « forcer la dernière version à chaque import ». Une mise à jour plus récente ne doit pas rendre inutile une invitation correctement préparée la veille.

Un échec de téléchargement ou de vérification ne remplace pas la sortie déjà installée. Il doit permettre de réessayer sans recoller le message si son stockage temporaire a réussi.

### Ouvrir l'application en mer

Le lancement retrouve la publication et l'état de la sortie active sans attendre de requête réseau. La présence soudaine de réseau ne change pas cette référence. Aucune fenêtre de mise à jour ne vient interrompre l'échange.

Les calculs ou transmissions qui étaient en cours avant la fermeture sont annulés. La sortie, sa zone active et les confirmations encore valides sont restaurées ; un échange interrompu est recommencé. Une ancienne phrase ne doit pas réapparaître comme transmission encore en cours par simple restauration d'écran.

### Rejouer une invitation

Le rejeu restaure la configuration originale et sa publication, avec les contrôles habituels. Il fonctionne hors connexion pour une sortie dont les fichiers nécessaires sont présents. Une invitation connue n'autorise jamais un changement silencieux de moteur.

La copie originale de la sortie doit être distincte de son état courant : changer accidentellement de secret ou de zone ne doit pas détruire la référence permettant de restaurer la sortie. Pour une très ancienne invitation dont les fichiers ont été nettoyés, un téléchargement serait nécessaire ; cette limite doit être explicite.

### Changer de zone ou utiliser les réglages avancés

Un changement de zone pendant la sortie conserve la publication de cette sortie. La confirmation radio actuelle reste nécessaire, car les autres téléphones ne peuvent pas recevoir ce changement automatiquement hors réseau.

Les réglages avancés doivent utiliser les mêmes protections de contexte et d'enregistrement. Une session préparée manuellement avec un secret seul ne peut pas apporter la même preuve automatique de configuration commune qu'une invitation complète. On ne doit pas présenter les deux parcours comme offrant la même garantie, ni supprimer ce parcours sans décision explicite.

## Architecture minimale nécessaire

### Un lancement stable et des publications immuables

Conserver l'adresse installée et l'identité de la PWA. Introduire un point d'entrée qui lit la référence de sortie avant de choisir la publication à ouvrir. Les publications utilisent des chemins distincts, par exemple `releases/<identifiant>/`, et ne sont jamais écrasées.

Le service worker conserve une adresse stable. Ses mises à jour techniques doivent respecter le contrat de stockage et ne jamais modifier la publication d'une sortie ni supprimer ses fichiers. Il ne suffit pas de versionner l'URL du service worker ou d'ajouter un paramètre à l'URL de l'application.

Les publications ne doivent plus enregistrer chacune un worker concurrent ni dépendre de fichiers métier non versionnés. Le découpage du HTML en plusieurs fichiers est possible, mais n'est pas un prérequis : tous les fichiers nécessaires doivent appartenir au même ensemble vérifié.

### Un manifeste de publication vérifiable

Chaque publication fournit sa liste exhaustive de fichiers avec leurs empreintes, sa version d'application, son PROTO, son COMPAT complet et les versions de formats de données nécessaires. Le canal de publication annonce une publication seulement après disponibilité et vérification de tous ses fichiers.

L'invitation contient une référence de publication, pas une URL exécutable arbitraire ni du JavaScript. Le téléchargement est limité à l'hébergement officiel et aux chemins attendus. Le contrôle d'intégrité des fichiers évite d'associer par erreur un HTML ancien à un identifiant de publication récent ; il ne protège pas contre une compromission de l'hébergement de confiance.

### Un enregistrement complet avant activation

Préparer les fichiers et le contexte en attente, vérifier le candidat sans modifier la sortie active, puis enregistrer ensemble la sortie et sa référence logicielle dans une transaction. IndexedDB est une option adaptée pour ce petit registre et ses états.

Le cache de fichiers et le registre de données n'ont pas de transaction commune : le processus doit gérer explicitement les interruptions. Un candidat incomplet reste inactif. Au démarrage, une référence dont les fichiers manquent doit être détectée. Si une réparation est possible, récupérer exactement la publication attendue ; ne jamais servir automatiquement une autre publication à sa place.

Les données de sortie doivent être isolées par contexte et format. Les publications ne peuvent pas continuer à partager sans précaution les clés globales actuelles. Les zones personnalisées constituent une bibliothèque utilisateur à préserver, avec migration explicite plutôt qu'effacement global du stockage.

Une seule fenêtre doit pouvoir modifier le contexte actif à la fois. Les autres fenêtres doivent détecter un changement de contexte, invalider leurs résultats et rejoindre l'état cohérent. Le mécanisme exact de coordination et ses solutions de repli doivent être vérifiés sur iOS et Android.

### Une identité de contexte pour les calculs radio

Les calculs d'empreinte, de zone, d'encodage et de décodage doivent capturer une révision de contexte et la revalider avant toute écriture dans l'interface. Cette identité comprend la sortie, la publication, le PROTO/COMPAT, le secret, la zone canonique et la révision des saisies concernées.

Les confirmations sauvegardées doivent se rattacher au contexte exact et à la géométrie de la zone, pas seulement à son identifiant local. Un changement de contexte invalide les résultats préparés et les confirmations qu'il rend obsolètes.

### Un archivage automatique, avec une politique explicite

Publier une copie complète ne signifie pas développer une nouvelle branche de maintenance pour chaque ancienne version. Les copies peuvent être produites automatiquement. En revanche, il faut assumer qu'une sortie figée conserve aussi les éventuels défauts de sa publication : aucun téléchargement ne peut corriger un téléphone actuellement hors réseau.

Les fichiers de la sortie active et de sa restauration doivent être protégés du nettoyage. Les candidats abandonnés et publications sans référence peuvent être supprimés. Le téléphone n'a pas besoin de télécharger tout l'historique.

La conservation côté serveur et le traitement d'une publication retirée pour défaut grave doivent être définis. Une invitation pointant vers une publication retirée doit être refusée clairement lors d'une nouvelle installation, jamais réinterprétée par un autre moteur. Un appareil hors réseau ne peut pas recevoir instantanément cet avis de retrait.

## Transition depuis V3.28.101

Les anciennes invitations n'ont pas de référence de publication ; leur PROTO/COMPAT ne permet pas de déterminer quelle version cosmétique les a produites. Les sorties sauvegardées actuelles n'enregistrent pas non plus leur COMPAT d'origine. Il serait donc incorrect de deviner silencieusement une publication historique.

La transition doit être préparée comme une publication spéciale, avant une diffusion terrain large. Elle peut offrir une reprise contrôlée des données dont l'origine est vérifiable et demander le rejeu de l'invitation lorsque cette preuve manque. Les zones personnalisées doivent être conservées. Aucune remise à zéro globale n'est justifiée.

Un ancien téléphone jamais mis à jour ne peut pas être contraint rétroactivement par un nouveau code qu'il n'a pas téléchargé. La garantie commence après installation de cette nouvelle organisation. La première transition avec les testeurs doit donc être vérifiée ; elle ne doit pas devenir une manipulation récurrente des pêcheurs.

## Ordre de réalisation recommandé

1. Corriger les résultats asynchrones périmés, rattacher les confirmations au contexte exact et empêcher les activations partielles. Ajouter des tests reproduisant les défauts constatés.
2. Construire un prototype de lancement avec deux publications volontairement incompatibles, sans modifier les écrans radio. Vérifier le téléchargement complet, l'activation, la restauration et le redémarrage hors réseau.
3. Automatiser la publication immuable, l'annonce de la version recommandée et les contrôles d'intégrité. Le COMPAT de PROTO 6 reste inchangé tant que ses règles radio ne changent pas ; le format d'invitation peut évoluer séparément.
4. Intégrer ce fonctionnement aux actions existantes de création et d'import, avec conservation du brouillon et du message pendant les chargements. Ne pas demander de fermer l'application ni de comparer ses versions.
5. Valider la transition, puis effectuer les essais réels Android/iPhone. La séparation du code en modules peut accompagner les frontières nécessaires au stockage et au lancement ; une refonte générale de l'interface n'est pas requise.

## Critères de validation avant diffusion

| Scénario | Résultat exigé |
|---|---|
| Deux téléphones préparent/acceptent la même invitation | Même publication, PROTO, COMPAT, empreinte, zone et résultats radio |
| Nouvelle publication entre création et import | Le receveur installe la publication désignée par l'invitation |
| Application laissée ouverte plusieurs jours puis nouvelle préparation | Contrôle réseau effectif, chargement de la publication recommandée, pas de brouillon perdu |
| Nouvelle publication pendant une sortie, puis fermeture et réouverture hors réseau | La sortie retrouve sa publication initiale |
| Connexion coupée à chaque étape du téléchargement | Aucune activation de candidat incomplet ; sortie précédente disponible |
| Arrêt brutal à chaque étape de l'enregistrement | Restauration d'un contexte complet, jamais un mélange de deux sorties |
| Changement de saisie, zone ou session pendant un calcul | Aucun résultat périmé ne réapparaît |
| Mauvais mot, mauvais ET/OU, mauvaise zone, mauvais secret ou confirmation finale erronée | Les protections radio conservent leurs refus et leurs états non confirmés |
| Rejeu après erreur de manipulation | Retour à la configuration originale avec sa publication exacte |
| Deux fenêtres concurrentes | Pas de résultats confirmés pour un contexte devenu inactif |
| Mauvaise empreinte d'un fichier ou fichiers mélangés lors du déploiement | Publication refusée avant activation |
| Cache partiellement absent ou stockage effacé | État indisponible explicite ; aucune substitution silencieuse de version |
| Safari et PWA installée, puis Chrome et PWA installée | Préparation vérifiée dans le contexte réellement utilisé ; aucune hypothèse de stockage partagé |
| Préparation anticipée et horloge décalée | Pas de suppression automatique de la sortie fondée sur une durée arbitraire |

Le succès des simulations Node actuelles ne valide pas ces scénarios de navigateur. Des essais de service worker dans un navigateur réel et des essais sur appareils sont nécessaires, notamment pour la fermeture forcée, la suspension, le redémarrage et le stockage.

## Limites assumées

La solution proposée contrôle les changements de publication et les changements de contexte de l'application. Elle ne garantit pas la conservation de données effacées par l'utilisateur ou le système, la présence de réseau au départ, l'absence de bugs dans une publication, ni le respect de la procédure radio par les personnes.

La demande de stockage persistant réduit certains risques lorsqu'elle est accordée ; elle ne remplace pas le contrôle des fichiers locaux. Une application ne peut pas récupérer une publication absente sans réseau. Il ne faut donc pas promettre « aucun problème possible » ni « tous les téléphones forcément à jour ». La promesse vérifiable est : **une sortie acceptée utilise un contexte cohérent, et l'application ne lui substitue jamais silencieusement une autre publication**.

## Sources techniques vérifiées

- [Cycle de vie des service workers — web.dev](https://web.dev/articles/service-worker-lifecycle) : installation, attente, activation après disparition des anciens clients et risques du remplacement forcé. Ce mécanisme ne verrouille pas à lui seul une sortie.
- [Politique de stockage — WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/) : stockage, éviction et demande de persistance sur les plateformes Apple.
- [Recherche dans les caches — MDN](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/match) : `CacheStorage.match()` peut rechercher dans plusieurs caches ; sa réussite n'identifie pas la publication active.
- [Publication GitHub Pages — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) : hébergement statique et délai de publication. Le délai annoncé ne constitue pas une garantie de synchronisation instantanée entre appareils.

Les propositions d'architecture et les conclusions concernant ce projet sont issues de l'analyse ; elles ne sont pas présentées comme une certification des fournisseurs cités.
