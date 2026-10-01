// Source de l’application distribuée.
const appStorage=window.VHFIntegration.storage;

"use strict";
const THEME_STORAGE_KEY="vhfGpsThemeModeV1";

function systemPrefersDark(){
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function resolvedTheme(mode){
  if(mode==="day")return "day";
  if(mode==="night")return "night";
  return systemPrefersDark()?"night":"day";
}
function applyTheme(mode){
  const safe=["auto","day","night"].includes(mode)?mode:"auto";
  document.documentElement.dataset.theme=resolvedTheme(safe);
  const themeMeta=document.getElementById("themeColorMeta");
  if(themeMeta)themeMeta.content=document.documentElement.dataset.theme==="day"?"#ffffff":"#06131a";
  const sel=document.getElementById("themeMode");
  if(sel)sel.value=safe;
}
function initTheme(){
  const saved=appStorage.getItem(THEME_STORAGE_KEY)||"auto";
  applyTheme(saved);

  const sel=document.getElementById("themeMode");
  if(sel){
    sel.value=saved;
    sel.addEventListener("change",()=>{
      appStorage.setItem(THEME_STORAGE_KEY,sel.value);
      applyTheme(sel.value);
    });
  }

  if(window.matchMedia){
    const mq=window.matchMedia("(prefers-color-scheme: dark)");
    const refresh=()=>{
      if((appStorage.getItem(THEME_STORAGE_KEY)||"auto")==="auto")applyTheme("auto");
    };
    if(mq.addEventListener)mq.addEventListener("change",refresh);
    else if(mq.addListener)mq.addListener(refresh);
  }
}

const APP_VERSION="3.28.113";
const PROTOCOL_ID="VHF-GPS-PROTO-6";

function protocolShortLabel(){
  const m=String(PROTOCOL_ID).match(/PROTO-(\d+)$/);
  return m?`PROTO ${m[1]}`:PROTOCOL_ID;
}
function appVersionLabel(){return `V${APP_VERSION}`;}
function initVersionUi(){
  const proto=protocolShortLabel(),app=appVersionLabel();
  document.title=`VHF GPS Code ${app} — ${proto}`;
  const set=(id,text)=>{const e=$(id);if(e)e.textContent=text;};
  set("protocolBadgeSession",proto);
  set("protocolInfoTitle","Fonctionnement :");
  set("catalogInfoTitle","Catalogue radio audité");
  set("protocolInlineLabel",proto);
}

function setPwaStatus(message,kind){
  const el=$("pwaStatus");
  el.textContent=message;
  el.className=`pwa-status ${kind}`;
}
// Installation de la PWA gérée par le lanceur ; cette sortie vérifie son propre cache hors réseau.
const SIDE_KM=250, HALF_KM=125, CELL_KM=0.1, CELLS=2500;
const ZONE_PROTOCOL_VERSION="ZONE-V3";
const ZONE_ALIAS_VERSION="ZONE-ALIAS-V2";
const EPHEMERAL_GRID_DEG=0.25;
const EPHEMERAL_PUBLIC_ANCHOR_MIN_KM=50;
const EPHEMERAL_EDGE_MARGIN_KM=50;
const EPHEMERAL_SECRET_OFFSET_MAX_KM=100;
const EPHEMERAL_ANCHOR_SEARCH_KM=200;
const EPHEMERAL_TTL_MS=48*60*60*1000;
const OUTING_EPHEMERAL_NAME="ÉPHÉMÈRE DE SORTIE";

const COMPAT_SPEC_VERSION="VHF-GPS-COMPAT-SPEC-3";
const SESSION_FINGERPRINT_VERSION="SESSION-FINGERPRINT-V3";
const PBKDF2_ITERATIONS=120000;
const FEISTEL_ROUNDS=8;
const TAG_BITS=9;
const TAG_SPACE=2 ** TAG_BITS;
const TAG_MASK=TAG_SPACE-1;

const PROTOCOL_STATE=Object.freeze({
  CHECKING:"CHECKING",
  OK:"OK",
  FAILED:"FAILED"
});
let protocolRuntimeState=PROTOCOL_STATE.CHECKING;

function setProtocolRuntimeState(state,detail=""){
  protocolRuntimeState=state;
  const banner=$("protocolFatalBanner");
  const detailEl=$("protocolFatalDetail");

  if(state===PROTOCOL_STATE.FAILED){
    if(detailEl)detailEl.textContent=detail;
    if(banner)banner.classList.remove("hidden");
  }else{
    if(banner)banner.classList.add("hidden");
    if(detailEl)detailEl.textContent="";
  }

  const status=$("protocolSelfTestStatus");
  if(status){
    if(state===PROTOCOL_STATE.CHECKING){
      status.textContent="Autotest protocole en cours…";
      status.className="status warn";
    }else if(state===PROTOCOL_STATE.OK){
      status.textContent="Autotest protocole : OK.";
      status.className="status ok";
    }else{
      status.textContent="AUTOTEST ÉCHOUÉ : "+detail;
      status.className="status bad";
    }
  }

  // Une application non validée ne doit produire aucune réponse radio.
  // En particulier, on annule un éventuel auto-décodage ou ACK/NACK déjà affiché
  // si un retest manuel fait repasser l'état à CHECKING/FAILED.
  if(state!==PROTOCOL_STATE.OK && typeof invalidateDecodedResult==="function"){
    invalidateDecodedResult();
  }

  if(typeof refreshEncodeState==="function"){
    refreshEncodeState();
  }
  if(typeof refreshDecodeState==="function"){
    refreshDecodeState();
  }
}

function assertProtocolReady(){
  if(protocolRuntimeState===PROTOCOL_STATE.CHECKING){
    throw new Error("Le protocole est encore en cours de vérification.");
  }
  if(protocolRuntimeState===PROTOCOL_STATE.FAILED){
    throw new Error("Le protocole a échoué à son autotest. Communication bloquée.");
  }
}

function assertProtocolInvariants(){
  if(!Number.isInteger(TAG_BITS) || TAG_BITS<=0 || TAG_BITS>=31){
    throw new Error(`TAG_BITS invalide : ${TAG_BITS}`);
  }
  if(TAG_SPACE !== 2 ** TAG_BITS){
    throw new Error("TAG_SPACE incohérent avec TAG_BITS.");
  }
  if(TAG_MASK !== TAG_SPACE-1){
    throw new Error("TAG_MASK incohérent avec TAG_SPACE.");
  }
  const expectedDomain=CELLS*CELLS*TAG_SPACE;
  if(expectedDomain!==DOMAIN){
    throw new Error(
      `Domaine incohérent : grille/tag=${expectedDomain}, phrases=${DOMAIN}.`
    );
  }
  if(SUBJECTS.length!==200 || QUALS.length!==200){
    throw new Error(
      `Catalogues incompatibles : ${SUBJECTS.length} sujets / ${QUALS.length} qualificatifs.`
    );
  }
  if(ACK_WORDS.length!==256 || new Set(ACK_WORDS.map(protocolToken)).size!==256){
    throw new Error(`Catalogue ACK incompatible : ${ACK_WORDS.length} mots, 256 uniques attendus.`);
  }
}
const ALGORITHM_IDS=Object.freeze({
  gridQuantization:"GRID-100M-CENTER-V1",
  payloadPacking:"INDEX-TAG9-V1",
  authenticationTag:"HMAC-TAG9-V1",
  feistelPermutation:"FEISTEL32-HMAC16-V1",
  domainCycleWalk:"DOMAIN-CYCLEWALK-V1",
  phraseMapping:"PHRASE-200x200x2x200x200-V1",
  zoneFingerprint:"ZONE-FINGERPRINT-V3",
  zoneAlias:"ZONE-ALIAS-HMAC-V2",
  ephemeralSecretCenter:"EPHEMERAL-CENTER-HMAC-V2",
  sessionFingerprint:"SESSION-FINGERPRINT-V3",
  ackNack:"ACK-NACK-HMAC-V1",
  finalConfirmation:"FINAL-CONFIRM-HMAC-V1",
  selfTestVector:"PROTOCOL-SELFTEST-V2"
});
const SUBJECTS=[{"w":"THON","g":"m"},{"w":"BONITE","g":"f"},{"w":"DORADE","g":"f"},{"w":"BAR","g":"m"},{"w":"MAIGRE","g":"m"},{"w":"MERLU","g":"m"},{"w":"LIEU","g":"m"},{"w":"TURBOT","g":"m"},{"w":"SOLE","g":"f"},{"w":"RAIE","g":"f"},{"w":"ROUSSETTE","g":"f"},{"w":"SARDINE","g":"f"},{"w":"ANCHOIS","g":"m"},{"w":"MAQUEREAU","g":"m"},{"w":"ESPADON","g":"m"},{"w":"MARLIN","g":"m"},{"w":"CONGRE","g":"m"},{"w":"MULET","g":"m"},{"w":"LOTTE","g":"f"},{"w":"TRUITE","g":"f"},{"w":"SAUMON","g":"m"},{"w":"ANGUILLE","g":"f"},{"w":"MORUE","g":"f"},{"w":"LIMANDE","g":"f"},{"w":"CARRELET","g":"m"},{"w":"RASCASSE","g":"f"},{"w":"TACAUD","g":"m"},{"w":"CABILLAUD","g":"m"},{"w":"REQUIN","g":"m"},{"w":"DAUPHIN","g":"m"},{"w":"ORQUE","g":"f"},{"w":"BALEINE","g":"f"},{"w":"TORTUE","g":"f"},{"w":"MEDUSE","g":"f"},{"w":"POULPE","g":"m"},{"w":"PIEUVRE","g":"f"},{"w":"CALAMAR","g":"m"},{"w":"ENCORNET","g":"m"},{"w":"SEICHE","g":"f"},{"w":"LANGOUSTE","g":"f"},{"w":"CRABE","g":"m"},{"w":"CREVETTE","g":"f"},{"w":"MOULE","g":"f"},{"w":"PALOURDE","g":"f"},{"w":"COQUE","g":"f"},{"w":"BULOT","g":"m"},{"w":"BIGORNEAU","g":"m"},{"w":"ORMEAU","g":"m"},{"w":"OURSIN","g":"m"},{"w":"GOBIE","g":"m"},{"w":"GRONDIN","g":"m"},{"w":"VIVE","g":"f"},{"w":"COCHON","g":"m"},{"w":"SERVEUR","g":"m"},{"w":"PERCHE","g":"f"},{"w":"GOELAND","g":"m"},{"w":"MACAREUX","g":"m"},{"w":"ALBATROS","g":"m"},{"w":"PINGOUIN","g":"m"},{"w":"OTARIE","g":"f"},{"w":"PELICAN","g":"m"},{"w":"LAMANTIN","g":"m"},{"w":"NARVAL","g":"m"},{"w":"MOUETTE","g":"f"},{"w":"CRUSTACE","g":"m"},{"w":"POISSON","g":"m"},{"w":"PECHEUR","g":"m"},{"w":"CAPITAINE","g":"m"},{"w":"AMIRAL","g":"m"},{"w":"PIRATE","g":"m"},{"w":"PLONGEUR","g":"m"},{"w":"PATRON","g":"m"},{"w":"COPAIN","g":"m"},{"w":"TONTON","g":"m"},{"w":"PAPY","g":"m"},{"w":"VOISIN","g":"m"},{"w":"TOURISTE","g":"m"},{"w":"CUISINIER","g":"m"},{"w":"DOUANIER","g":"m"},{"w":"PILOTE","g":"m"},{"w":"VIGIE","g":"f"},{"w":"MONITEUR","g":"m"},{"w":"NAGEUR","g":"m"},{"w":"SURFEUR","g":"m"},{"w":"MECANO","g":"m"},{"w":"DOCTEUR","g":"m"},{"w":"DENTISTE","g":"m"},{"w":"BOULANGER","g":"m"},{"w":"FACTEUR","g":"m"},{"w":"POMPIER","g":"m"},{"w":"JARDINIER","g":"m"},{"w":"ARBITRE","g":"m"},{"w":"JOUEUR","g":"m"},{"w":"GARDIEN","g":"m"},{"w":"VENDEUR","g":"m"},{"w":"CLIENT","g":"m"},{"w":"CHEF","g":"m"},{"w":"BEBE","g":"m"},{"w":"GAMIN","g":"m"},{"w":"ADO","g":"m"},{"w":"BEAUF","g":"m"},{"w":"POTE","g":"m"},{"w":"VOYOU","g":"m"},{"w":"CLOWN","g":"m"},{"w":"SEBASTIEN","g":"m"},{"w":"BISTROTIER","g":"m"},{"w":"CHAUFFEUR","g":"m"},{"w":"VETERINAIRE","g":"m"},{"w":"INFIRMIER","g":"m"},{"w":"PAYSAN","g":"m"},{"w":"BRICOLEUR","g":"m"},{"w":"DANSEUR","g":"m"},{"w":"BATTEUR","g":"m"},{"w":"GUITARISTE","g":"m"},{"w":"ACROBATE","g":"m"},{"w":"APPRENTI","g":"m"},{"w":"ASTICOT","g":"m"},{"w":"ATHLETE","g":"m"},{"w":"AVOCAT","g":"m"},{"w":"EMPLOYE","g":"m"},{"w":"ETUDIANT","g":"m"},{"w":"EXPERT","g":"m"},{"w":"FILOU","g":"m"},{"w":"FLIBUSTIER","g":"m"},{"w":"NEVEU","g":"m"},{"w":"OPTICIEN","g":"m"},{"w":"PROF","g":"m"},{"w":"RUGBYMAN","g":"m"},{"w":"TERRIEN","g":"m"},{"w":"URGENCISTE","g":"m"},{"w":"ARTISAN","g":"m"},{"w":"AGRICULTEUR","g":"m"},{"w":"ASSUREUR","g":"m"},{"w":"DESSINATEUR","g":"m"},{"w":"ELECTRICIEN","g":"m"},{"w":"ENTRAINEUR","g":"m"},{"w":"FORESTIER","g":"m"},{"w":"LIBRAIRE","g":"m"},{"w":"LIVREUR","g":"m"},{"w":"MUSICIEN","g":"m"},{"w":"NEGOCIANT","g":"m"},{"w":"RETRAITE","g":"m"},{"w":"AIGLE","g":"m"},{"w":"AUTRUCHE","g":"f"},{"w":"DINDON","g":"m"},{"w":"OIE","g":"f"},{"w":"CHIEN","g":"m"},{"w":"LAPIN","g":"m"},{"w":"RENARD","g":"m"},{"w":"LOUP","g":"m"},{"w":"SANGLIER","g":"m"},{"w":"VACHE","g":"f"},{"w":"TAUREAU","g":"m"},{"w":"ANE","g":"m"},{"w":"ALPAGA","g":"m"},{"w":"ZEBRE","g":"m"},{"w":"TIGRE","g":"m"},{"w":"SINGE","g":"m"},{"w":"GORILLE","g":"m"},{"w":"BABOUIN","g":"m"},{"w":"CROCODILE","g":"m"},{"w":"LEZARD","g":"m"},{"w":"GRENOUILLE","g":"f"},{"w":"ESCARGOT","g":"m"},{"w":"ABEILLE","g":"f"},{"w":"GUEPE","g":"f"},{"w":"FRELON","g":"m"},{"w":"ARAIGNEE","g":"f"},{"w":"FOURMI","g":"f"},{"w":"VER","g":"m"},{"w":"BLAIREAU","g":"m"},{"w":"BUFFLE","g":"m"},{"w":"PUMA","g":"m"},{"w":"JAGUAR","g":"m"},{"w":"LYNX","g":"m"},{"w":"RAT","g":"m"},{"w":"SOURIS","g":"f"},{"w":"PUTOIS","g":"m"},{"w":"BELETTE","g":"f"},{"w":"ECUREUIL","g":"m"},{"w":"DAIM","g":"m"},{"w":"FAON","g":"m"},{"w":"BICHE","g":"f"},{"w":"DEDE","g":"m"},{"w":"JOJO","g":"m"},{"w":"LOLO","g":"m"},{"w":"NANARD","g":"m"},{"w":"ROBERT","g":"m"},{"w":"RAYMOND","g":"m"},{"w":"ROGER","g":"m"},{"w":"BERNARD","g":"m"},{"w":"DIDIER","g":"m"},{"w":"JACKY","g":"m"},{"w":"MICHEL","g":"m"},{"w":"JULES","g":"m"},{"w":"FERNAND","g":"m"},{"w":"GASTON","g":"m"},{"w":"LEON","g":"m"},{"w":"LUCIEN","g":"m"},{"w":"DRESSEUR","g":"m"}];
const QUALS=[{"m":"GRACIEUX","f":"GRACIEUSE"},{"m":"ROCOCO","f":"ROCOCO"},{"m":"AGACE","f":"AGACEE"},{"m":"ALLUME","f":"ALLUMEE"},{"m":"DROLATIQUE","f":"DROLATIQUE"},{"m":"BONDISSANT","f":"BONDISSANTE"},{"m":"UBUESQUE","f":"UBUESQUE"},{"m":"LOUFOQUE","f":"LOUFOQUE"},{"m":"OPTIMISTE","f":"OPTIMISTE"},{"m":"PAPILLONNANT","f":"PAPILLONNANTE"},{"m":"HILARE","f":"HILARE"},{"m":"CABOSSE","f":"CABOSSEE"},{"m":"SENSATIONNEL","f":"SENSATIONNELLE"},{"m":"ALTRUISTE","f":"ALTRUISTE"},{"m":"JOVIAL","f":"JOVIALE"},{"m":"CROUSTILLANT","f":"CROUSTILLANTE"},{"m":"BURLESQUE","f":"BURLESQUE"},{"m":"DECOIFFE","f":"DECOIFFEE"},{"m":"ESPIEGLE","f":"ESPIEGLE"},{"m":"ZOUZOU","f":"ZOUZOU"},{"m":"DEMONTE","f":"DEMONTEE"},{"m":"TAPAGEUR","f":"TAPAGEUSE"},{"m":"PITTORESQUE","f":"PITTORESQUE"},{"m":"EMBALLE","f":"EMBALLEE"},{"m":"EMMELE","f":"EMMELEE"},{"m":"ENERVE","f":"ENERVEE"},{"m":"ENROUE","f":"ENROUEE"},{"m":"DEBONNAIRE","f":"DEBONNAIRE"},{"m":"INSOLITE","f":"INSOLITE"},{"m":"FACHE","f":"FACHEE"},{"m":"GOGUENARD","f":"GOGUENARDE"},{"m":"FICELE","f":"FICELEE"},{"m":"EXCENTRIQUE","f":"EXCENTRIQUE"},{"m":"FROISSE","f":"FROISSEE"},{"m":"FUME","f":"FUMEE"},{"m":"PAISIBLE","f":"PAISIBLE"},{"m":"GONFLE","f":"GONFLEE"},{"m":"GRILLE","f":"GRILLEE"},{"m":"SURREALISTE","f":"SURREALISTE"},{"m":"CHATOUILLE","f":"CHATOUILLEE"},{"m":"MOISI","f":"MOISIE"},{"m":"MOUILLE","f":"MOUILLEE"},{"m":"PAUME","f":"PAUMEE"},{"m":"LUMINEUX","f":"LUMINEUSE"},{"m":"PLEIN","f":"PLEINE"},{"m":"PLIE","f":"PLIEE"},{"m":"POURRI","f":"POURRIE"},{"m":"RAPE","f":"RAPEE"},{"m":"RINCE","f":"RINCEE"},{"m":"DIPLOMATE","f":"DIPLOMATE"},{"m":"SECOUE","f":"SECOUEE"},{"m":"HURLUBERLU","f":"HURLUBERLUE"},{"m":"MYSTIQUE","f":"MYSTIQUE"},{"m":"TREMPE","f":"TREMPEE"},{"m":"TROUE","f":"TROUEE"},{"m":"LIMPIDE","f":"LIMPIDE"},{"m":"VEXE","f":"VEXEE"},{"m":"ROTI","f":"ROTIE"},{"m":"MARINE","f":"MARINEE"},{"m":"PANE","f":"PANEE"},{"m":"SALE","f":"SALE"},{"m":"SUCRE","f":"SUCREE"},{"m":"EPICE","f":"EPICEE"},{"m":"CONGELE","f":"CONGELEE"},{"m":"SURGELE","f":"SURGELEE"},{"m":"MAGNIFIQUE","f":"MAGNIFIQUE"},{"m":"SOLENNEL","f":"SOLENNELLE"},{"m":"MIJOTE","f":"MIJOTEE"},{"m":"POELE","f":"POELEE"},{"m":"BRAISE","f":"BRAISEE"},{"m":"ABRUTI","f":"ABRUTIE"},{"m":"ELEGANT","f":"ELEGANTE"},{"m":"DODU","f":"DODUE"},{"m":"ENDORMI","f":"ENDORMIE"},{"m":"ETOURDI","f":"ETOURDIE"},{"m":"FOUTU","f":"FOUTUE"},{"m":"RONCHON","f":"RONCHONNE"},{"m":"GUILLERET","f":"GUILLERETTE"},{"m":"NU","f":"NUE"},{"m":"POILU","f":"POILUE"},{"m":"RAVI","f":"RAVIE"},{"m":"REPU","f":"REPUE"},{"m":"MALICIEUX","f":"MALICIEUSE"},{"m":"VENDU","f":"VENDUE"},{"m":"VELU","f":"VELUE"},{"m":"ABSURDE","f":"ABSURDE"},{"m":"BIZARRE","f":"BIZARRE"},{"m":"COMIQUE","f":"COMIQUE"},{"m":"DINGUE","f":"DINGUE"},{"m":"DROLE","f":"DROLE"},{"m":"ENORME","f":"ENORME"},{"m":"FEROCE","f":"FEROCE"},{"m":"IMMONDE","f":"IMMONDE"},{"m":"IMPOSSIBLE","f":"IMPOSSIBLE"},{"m":"INCROYABLE","f":"INCROYABLE"},{"m":"LOUCHE","f":"LOUCHE"},{"m":"MINABLE","f":"MINABLE"},{"m":"MOCHE","f":"MOCHE"},{"m":"PENIBLE","f":"PENIBLE"},{"m":"RIDICULE","f":"RIDICULE"},{"m":"SAUVAGE","f":"SAUVAGE"},{"m":"STUPIDE","f":"STUPIDE"},{"m":"TIMIDE","f":"TIMIDE"},{"m":"TRISTE","f":"TRISTE"},{"m":"TRANQUILLE","f":"TRANQUILLE"},{"m":"TERRIBLE","f":"TERRIBLE"},{"m":"TOXIQUE","f":"TOXIQUE"},{"m":"VULGAIRE","f":"VULGAIRE"},{"m":"EXCITE","f":"EXCITEE"},{"m":"LARGUE","f":"LARGUEE"},{"m":"PRESSE","f":"PRESSEE"},{"m":"HARMONIEUX","f":"HARMONIEUSE"},{"m":"REVEILLE","f":"REVEILLEE"},{"m":"ZINZIN","f":"ZINZIN"},{"m":"NAZE","f":"NAZE"},{"m":"ACCROCHE","f":"ACCROCHEE"},{"m":"SPLENDIDE","f":"SPLENDIDE"},{"m":"BALANCE","f":"BALANCEE"},{"m":"BARBOUILLE","f":"BARBOUILLEE"},{"m":"BASCULE","f":"BASCULEE"},{"m":"BOSSE","f":"BOSSEE"},{"m":"BRICOLE","f":"BRICOLEE"},{"m":"SPIRITUEL","f":"SPIRITUELLE"},{"m":"CHIFFONNE","f":"CHIFFONNEE"},{"m":"EBOURIFFE","f":"EBOURIFFEE"},{"m":"BARIOLE","f":"BARIOLEE"},{"m":"EFFRAYE","f":"EFFRAYEE"},{"m":"FANE","f":"FANEE"},{"m":"IRRESISTIBLE","f":"IRRESISTIBLE"},{"m":"MIXE","f":"MIXEE"},{"m":"GUINDE","f":"GUINDEE"},{"m":"PIQUE","f":"PIQUEE"},{"m":"RATATINE","f":"RATATINEE"},{"m":"TARTINE","f":"TARTINEE"},{"m":"AMUSE","f":"AMUSEE"},{"m":"FLEURI","f":"FLEURIE"},{"m":"ATTACHE","f":"ATTACHEE"},{"m":"CHARGE","f":"CHARGEE"},{"m":"COLLE","f":"COLLEE"},{"m":"ECARTE","f":"ECARTEE"},{"m":"VOLUBILE","f":"VOLUBILE"},{"m":"SOURIANT","f":"SOURIANTE"},{"m":"EPATE","f":"EPATEE"},{"m":"EVAPORE","f":"EVAPOREE"},{"m":"BIGARRE","f":"BIGARREE"},{"m":"FARCI","f":"FARCIE"},{"m":"FLAMBE","f":"FLAMBEE"},{"m":"FRUSTRE","f":"FRUSTREE"},{"m":"GRATINE","f":"GRATINEE"},{"m":"IMBIBE","f":"IMBIBEE"},{"m":"INTRIGUE","f":"INTRIGUEE"},{"m":"JETE","f":"JETEE"},{"m":"NETTOYE","f":"NETTOYEE"},{"m":"POMPE","f":"POMPEE"},{"m":"RAJEUNI","f":"RAJEUNIE"},{"m":"RECYCLE","f":"RECYCLEE"},{"m":"SATURE","f":"SATUREE"},{"m":"SOULAGE","f":"SOULAGEE"},{"m":"NOSTALGIQUE","f":"NOSTALGIQUE"},{"m":"VACCINE","f":"VACCINEE"},{"m":"VIDE","f":"VIDEE"},{"m":"EMU","f":"EMUE"},{"m":"LUNATIQUE","f":"LUNATIQUE"},{"m":"AMICAL","f":"AMICALE"},{"m":"AVACHI","f":"AVACHIE"},{"m":"BEURRE","f":"BEURREE"},{"m":"CLAQUE","f":"CLAQUEE"},{"m":"DUPE","f":"DUPEE"},{"m":"JUCHE","f":"JUCHEE"},{"m":"LEVE","f":"LEVEE"},{"m":"DANDINE","f":"DANDINEE"},{"m":"MUR","f":"MURE"},{"m":"OCCUPE","f":"OCCUPEE"},{"m":"ORIGINAL","f":"ORIGINALE"},{"m":"HYPNOTIQUE","f":"HYPNOTIQUE"},{"m":"RUSE","f":"RUSEE"},{"m":"SIDERE","f":"SIDEREE"},{"m":"ZAPPE","f":"ZAPPEE"},{"m":"CLOUE","f":"CLOUEE"},{"m":"FIGE","f":"FIGEE"},{"m":"BUTE","f":"BUTEE"},{"m":"FOIRE","f":"FOIREE"},{"m":"LAVE","f":"LAVEE"},{"m":"PUNI","f":"PUNIE"},{"m":"PRINCIER","f":"PRINCIERE"},{"m":"FLAMBOYANT","f":"FLAMBOYANTE"},{"m":"ZEBRE","f":"ZEBREE"},{"m":"MUSCLE","f":"MUSCLEE"},{"m":"BOUILLI","f":"BOUILLIE"},{"m":"AMOLLI","f":"AMOLLIE"},{"m":"VENTRU","f":"VENTRUE"},{"m":"CRADO","f":"CRADO"},{"m":"FRAGILE","f":"FRAGILE"},{"m":"RIEUR","f":"RIEUSE"},{"m":"PIMPANT","f":"PIMPANTE"},{"m":"TIMBRE","f":"TIMBREE"},{"m":"ARROSE","f":"ARROSEE"},{"m":"ESSORE","f":"ESSOREE"},{"m":"ATTRISTE","f":"ATTRISTEE"},{"m":"ETONNE","f":"ETONNEE"}];
const CODE_BASE=200;
const DOMAIN=3200000000;
const ACK_WORDS=["PANTOUFLE","CORNICHON","BOURRICOT","MOUSTACHE","CACAHUETE","BOULETTE","FRIPOUILLE","PATAPOUF","BOUFFON","TARTIFLETTE","BANANE","CHOUCROUTE","BISCOTTE","CAMEMBERT","SAUCISSE","AQUARELLE","MARMOTTE","ARMOIRE","DINOSAURE","BABIOLE","POIREAU","NAVET","PATATE","COURGETTE","CAROTTE","PIMENT","HARICOT","BROCOLI","CHAMPIGNON","RADIS","OIGNON","AIL","MAYONNAISE","KETCHUP","MOUTARDE","BECHAMEL","GRATIN","RACLETTE","FONDUE","CREPE","GAUFRE","CROISSANT","BRIOCHE","BAGUETTE","CROUTON","BISCUIT","BONBON","CARAMEL","CHOCOLAT","NOUGAT","GUIMAUVE","POPCORN","PISTACHE","PRALINE","CONFITURE","COMPOTE","MELON","PASTEQUE","KIWI","PAPAYE","MANGUE","ANANAS","ABRICOT","CERISE","FRAISE","MIRABELLE","MYRTILLE","FRAMBOISE","GROSEILLE","CITRON","ORANGE","PAMPLEMOUSSE","BALANÇOIRE","BIBERON","BOUTEILLE","KOALA","PANDA","BROUETTE","CALENDRIER","GIRAFE","BISON","CAMIONNETTE","CASTOR","LOUTRE","CANAPÉ","CARROUSEL","HIBOU","MONTGOLFIÈRE","HERON","CANARD","CYGNE","COQ","HÉRISSON","CHEMINÉE","CITROUILLE","PERROQUET","CHAMEAU","DROMADAIRE","LAMA","CLOCHETTE","CHEVRE","MOUTON","COCCINELLE","OURS","MARTEAU","TOURNEVIS","PINCE","TENAILLE","PELLE","PIOCHE","RATEAU","BALAI","SERPILLIERE","EPONGE","SAVON","SHAMPOING","PEIGNE","BROSSE","MIROIR","SERVIETTE","CASQUETTE","BONNET","SOMBRERO","BERET","QUENELLE","CHAUSSETTE","SANDALE","BASKET","BOTTINE","SLIP","CALECON","MAILLOT","PYJAMA","CRAVATE","BRETELLE","CEINTURE","TROMPETTE","TROMBONE","TUBA","BANJO","PIANO","GUITARE","VIOLON","TAMBOUR","MARACAS","SIFFLET","CLOCHE","CLARINETTE","SAXO","ACCORDEON","HARPE","FLUTE","FUSEE","SATELLITE","COMETE","ASTEROIDE","COSMOS","NEBULEUSE","JUPITER","SATURNE","MERCURE","VENUS","MARS","PLUTON","GALAXIE","METEORE","ECLIPSE","ORBITE","COLLERETTE","CORSAIRE","CONFETTI","MOUSSE","COUETTE","CRAYON","MATELOT","BARBU","TRIBORD","BABORD","PONTON","ANCRE","BOUEE","PHARE","QUAI","CORDAGE","HOMARD","DENTELLE","DESSERT","DRAGON","ÉCHARPE","ESCABEAU","FARANDOLE","FENÊTRE","FOUGÈRE","FRITEUSE","GRENADINE","HAMAC","HÉLICOPTÈRE","JONQUILLE","KANGOUROU","LANTERNE","LIBELLULE","LUCIOLE","MARGUERITE","NAPPERON","OLIVIER","PARAPLUIE","PIROUETTE","ROULOTTE","FARCEUR","COQUIN","CANAILLE","SALOPETTE","TORCHON","DODU","POILU","RIGOLO","LOUSTIC","ZIGOTO","ZOUAVE","GUIGNOL","CABOTIN","CHARLOT","LURON","FADA","TOTO","TUTU","MOUFETTE","JONGLAGE","MIMI","TAMBOURIN","TOBOGGAN","ZAZA","BIDULE","MACHIN","TRUC","BAZAR","BOUSIN","BROL","SCHMILBLICK","FOURBI","CHOSE","PATATRAS","BOUM","POUET","TSOINTSOIN","BADABOUM","PLOUF","CRAC","COUCOU","PENDULE","TAMARIN","BEDAINE","MOUSTIQUE","LIMACE","VIOLONCELLE","CRAPAUD"];
const BUILTIN_ZONES = [
  {id:"iroise-brest",name:"IROISE / BREST",lat:48.30000,lon:-5.20000,region:"Atlantique",builtin:true},
  {id:"lorient-groix",name:"LORIENT / GROIX",lat:47.65000,lon:-4.20000,region:"Atlantique",builtin:true},
  {id:"belle-ile-quiberon",name:"BELLE-ILE / QUIBERON",lat:47.35000,lon:-3.90000,region:"Atlantique",builtin:true},
  {id:"yeu-noirmoutier",name:"YEU / NOIRMOUTIER",lat:46.85000,lon:-3.00000,region:"Atlantique",builtin:true},
  {id:"sables",name:"LES SABLES / LARGE",lat:46.50000,lon:-2.85000,region:"Atlantique",builtin:true},
  {id:"rochebonne",name:"ROCHEBONNE",lat:46.217334,lon:-2.429111,region:"Atlantique",builtin:true},
  {id:"la-rochelle-re",name:"LA ROCHELLE / ILE DE RE",lat:46.15000,lon:-2.05000,region:"Atlantique",builtin:true},
  {id:"gironde-cordouan",name:"GIRONDE / CORDOUAN",lat:45.55000,lon:-2.20000,region:"Atlantique",builtin:true},
  {id:"arcachon",name:"ARCACHON / LARGE",lat:44.65000,lon:-2.10000,region:"Atlantique",builtin:true},
  {id:"bayonne-capbreton",name:"BAYONNE / CAPBRETON",lat:43.60000,lon:-2.15000,region:"Atlantique",builtin:true}
];
const $=id=>document.getElementById(id);
const DEBUG_DETAILS_STORAGE_KEY="vhfGpsDebugDetailsV1";
let debugDetailsReady=false;
function refreshDebugDetails(){
  $("debugBlock").classList.toggle("hidden",!debugDetailsReady || !$("showDebugDetails").checked);
}
$("showDebugDetails").checked=appStorage.getItem(DEBUG_DETAILS_STORAGE_KEY)==="1";
$("showDebugDetails").addEventListener("change",()=>{
  appStorage.setItem(DEBUG_DETAILS_STORAGE_KEY,$("showDebugDetails").checked?"1":"0");
  refreshDebugDetails();
});
const DISPLAY_WORDS={"MEDUSE":"MÉDUSE","GOELAND":"GOÉLAND","PELICAN":"PÉLICAN","CRUSTACE":"CRUSTACÉ","PECHEUR":"PÊCHEUR","MECANO":"MÉCANO","BEBE":"BÉBÉ","SEBASTIEN":"SÉBASTIEN","VETERINAIRE":"VÉTÉRINAIRE","URGENCISTE":"URGENTISTE","ATHLETE":"ATHLÈTE","EMPLOYE":"EMPLOYÉ","ETUDIANT":"ÉTUDIANT","ELECTRICIEN":"ÉLECTRICIEN","ENTRAINEUR":"ENTRAÎNEUR","NEGOCIANT":"NÉGOCIANT","RETRAITE":"RETRAITÉ","ANE":"ÂNE","ZEBRE":"ZÉBRÉ","LEZARD":"LÉZARD","GUEPE":"GUÊPE","ARAIGNEE":"ARAIGNÉE","ECUREUIL":"ÉCUREUIL","DEDE":"DÉDÉ","LEON":"LÉON","CACAHUETE":"CACAHUÈTE","BECHAMEL":"BÉCHAMEL","CREPE":"CRÊPE","PASTEQUE":"PASTÈQUE","HERON":"HÉRON","BERET":"BÉRET","CALECON":"CALEÇON","FUSEE":"FUSÉE","COMETE":"COMÈTE","ASTEROIDE":"ASTÉROÏDE","NEBULEUSE":"NÉBULEUSE","METEORE":"MÉTÉORE","BOUEE":"BOUÉE","EPONGE":"ÉPONGE","RATEAU":"RÂTEAU","FLUTE":"FLÛTE","ABIME":"ABÎMÉ","ABIMEE":"ABÎMÉE","AFFAME":"AFFAMÉ","AFFAMEE":"AFFAMÉE","AGACE":"AGACÉ","AGACEE":"AGACÉE","ALLUME":"ALLUMÉ","ALLUMEE":"ALLUMÉE","AMOCHE":"AMOCHÉ","AMOCHEE":"AMOCHÉE","ARRACHE":"ARRACHÉ","ARRACHEE":"ARRACHÉE","ASSOMME":"ASSOMMÉ","ASSOMMEE":"ASSOMMÉE","BLESSE":"BLESSÉ","BLESSEE":"BLESSÉE","BLOQUE":"BLOQUÉ","BLOQUEE":"BLOQUÉE","BOURRE":"BOURRÉ","BOURREE":"BOURRÉE","BRULE":"BRÛLÉ","BRULEE":"BRÛLÉE","CABOSSE":"CABOSSÉ","CABOSSEE":"CABOSSÉE","CASSE":"CASSÉ","CASSEE":"CASSÉE","CHOQUE":"CHOQUÉ","CHOQUEE":"CHOQUÉE","COINCE":"COINCÉ","COINCEE":"COINCÉE","CRAME":"CRAMÉ","CRAMEE":"CRAMÉE","CREVE":"CREVÉ","CREVEE":"CREVÉE","DECOIFFE":"DÉCOIFFÉ","DECOIFFEE":"DÉCOIFFÉE","DEFONCE":"DÉFONCÉ","DEFONCEE":"DÉFONCÉE","DEGLINGUE":"DÉGLINGUÉ","DEGLINGUEE":"DÉGLINGUÉE","DEMONTE":"DÉMONTÉ","DEMONTEE":"DÉMONTÉE","ECLATE":"ÉCLATÉ","ECLATEE":"ÉCLATÉE","ECRASE":"ÉCRASÉ","ECRASEE":"ÉCRASÉE","EMBALLE":"EMBALLÉ","EMBALLEE":"EMBALLÉE","EMMELE":"EMMÊLÉ","EMMELEE":"EMMÊLÉE","ENERVE":"ÉNERVÉ","ENERVEE":"ÉNERVÉE","ENROUE":"ENROUÉ","ENROUEE":"ENROUÉE","EPUISE":"ÉPUISÉ","EPUISEE":"ÉPUISÉE","ESSOUFFLE":"ESSOUFFLÉ","ESSOUFFLEE":"ESSOUFFLÉE","FACHE":"FÂCHÉ","FACHEE":"FÂCHÉE","FATIGUE":"FATIGUÉ","FATIGUEE":"FATIGUÉE","FICELE":"FICELÉ","FICELEE":"FICELÉE","FRACASSE":"FRACASSÉ","FRACASSEE":"FRACASSÉE","FROISSE":"FROISSÉ","FROISSEE":"FROISSÉE","FUME":"FUMÉ","FUMEE":"FUMÉE","GAVE":"GAVÉ","GAVEE":"GAVÉE","GONFLE":"GONFLÉ","GONFLEE":"GONFLÉE","GRILLE":"GRILLÉ","GRILLEE":"GRILLÉE","MALMENE":"MALMENÉ","MALMENEE":"MALMENÉE","MASSACRE":"MASSACRÉ","MASSACREE":"MASSACRÉE","MOISI":"MOISI","MOISIE":"MOISIE","MOUILLE":"MOUILLÉ","MOUILLEE":"MOUILLÉE","PAUME":"PAUMÉ","PAUMEE":"PAUMÉE","PERDU":"PERDU","PERDUE":"PERDUE","PETE":"PÉTÉ","PETEE":"PÉTÉE","PLIE":"PLIÉ","PLIEE":"PLIÉE","POURRI":"POURRI","POURRIE":"POURRIE","RAPE":"RÂPÉ","RAPEE":"RÂPÉE","RINCE":"RINCÉ","RINCEE":"RINCÉE","ROUILLE":"ROUILLÉ","ROUILLEE":"ROUILLÉE","SECOUE":"SECOUÉ","SECOUEE":"SECOUÉE","SONNE":"SONNÉ","SONNEE":"SONNÉE","TACHE":"TACHÉ","TACHEE":"TACHÉE","TREMPE":"TREMPÉ","TREMPEE":"TREMPÉE","TROUE":"TROUÉ","TROUEE":"TROUÉE","USE":"USÉ","USEE":"USÉE","VEXE":"VEXÉ","VEXEE":"VEXÉE","ROTI":"RÔTI","ROTIE":"RÔTIE","MARINE":"MARINÉ","MARINEE":"MARINÉE","PANE":"PANÉ","PANEE":"PANÉE","SALE":"SALE","SUCRE":"SUCRÉ","SUCREE":"SUCRÉE","EPICE":"ÉPICÉ","EPICEE":"ÉPICÉE","CONGELE":"CONGELÉ","CONGELEE":"CONGELÉE","SURGELE":"SURGELÉ","SURGELEE":"SURGELÉE","CARBONISE":"CARBONISÉ","CARBONISEE":"CARBONISÉE","CALCINE":"CALCINÉ","CALCINEE":"CALCINÉE","MIJOTE":"MIJOTÉ","MIJOTEE":"MIJOTÉE","POELE":"POÊLÉ","POELEE":"POÊLÉE","BRAISE":"BRAISÉ","BRAISEE":"BRAISÉE","ABRUTI":"ABRUTI","ABRUTIE":"ABRUTIE","AMAIGRI":"AMAIGRI","AMAIGRIE":"AMAIGRIE","DODU":"DODU","DODUE":"DODUE","ENDORMI":"ENDORMI","ENDORMIE":"ENDORMIE","ETOURDI":"ÉTOURDI","ETOURDIE":"ÉTOURDIE","FOUTU":"FOUTU","FOUTUE":"FOUTUE","MAIGRI":"MAIGRI","MAIGRIE":"MAIGRIE","MORDU":"MORDU","MORDUE":"MORDUE","NU":"NU","NUE":"NUE","POILU":"POILU","POILUE":"POILUE","RAVI":"RAVI","RAVIE":"RAVIE","REPU":"REPU","REPUE":"REPUE","TORDU":"TORDU","TORDUE":"TORDUE","VENDU":"VENDU","VENDUE":"VENDUE","VELU":"VELU","VELUE":"VELUE","ABSURDE":"ABSURDE","BIZARRE":"BIZARRE","COMIQUE":"COMIQUE","DINGUE":"DINGUE","DROLE":"DRÔLE","ENORME":"ÉNORME","FEROCE":"FÉROCE","IMMONDE":"IMMONDE","IMPOSSIBLE":"IMPOSSIBLE","INCROYABLE":"INCROYABLE","LOUCHE":"LOUCHE","MINABLE":"MINABLE","MOCHE":"MOCHE","PENIBLE":"PÉNIBLE","RIDICULE":"RIDICULE","SAUVAGE":"SAUVAGE","STUPIDE":"STUPIDE","TIMIDE":"TIMIDE","TRISTE":"TRISTE","TRANQUILLE":"TRANQUILLE","TERRIBLE":"TERRIBLE","TOXIQUE":"TOXIQUE","VULGAIRE":"VULGAIRE","EXCITE":"EXCITÉ","EXCITEE":"EXCITÉE","LARGUE":"LARGUÉ","LARGUEE":"LARGUÉE","PRESSE":"PRESSÉ","PRESSEE":"PRESSÉE","REMONTE":"REMONTÉ","REMONTEE":"REMONTÉE","REVEILLE":"RÉVEILLÉ","REVEILLEE":"RÉVEILLÉE","ZINZIN":"ZINZIN","NAZE":"NAZE","ACCROCHE":"ACCROCHÉ","ACCROCHEE":"ACCROCHÉE","ACHEVE":"ACHEVÉ","ACHEVEE":"ACHEVÉE","BALANCE":"BALANCÉ","BALANCEE":"BALANCÉE","BARBOUILLE":"BARBOUILLÉ","BARBOUILLEE":"BARBOUILLÉE","BASCULE":"BASCULÉ","BASCULEE":"BASCULÉE","BOSSE":"BOSSÉ","BOSSEE":"BOSSÉE","BRICOLE":"BRICOLÉ","BRICOLEE":"BRICOLÉE","BROYE":"BROYÉ","BROYEE":"BROYÉE","CHIFFONNE":"CHIFFONNÉ","CHIFFONNEE":"CHIFFONNÉE","EBOURIFFE":"ÉBOURIFFÉ","EBOURIFFEE":"ÉBOURIFFÉE","ECORCHE":"ÉCORCHÉ","ECORCHEE":"ÉCORCHÉE","EFFRAYE":"EFFRAYÉ","EFFRAYEE":"EFFRAYÉE","FANE":"FANÉ","FANEE":"FANÉE","INONDE":"INONDÉ","INONDEE":"INONDÉE","MIXE":"MIXÉ","MIXEE":"MIXÉE","NOYE":"NOYÉ","NOYEE":"NOYÉE","PIQUE":"PIQUÉ","PIQUEE":"PIQUÉE","RATATINE":"RATATINÉ","RATATINEE":"RATATINÉE","TARTINE":"TARTINÉ","TARTINEE":"TARTINÉE","AMUSE":"AMUSÉ","AMUSEE":"AMUSÉE","APEURE":"APEURÉ","APEUREE":"APEURÉE","ATTACHE":"ATTACHÉ","ATTACHEE":"ATTACHÉE","CHARGE":"CHARGÉ","CHARGEE":"CHARGÉE","COLLE":"COLLÉ","COLLEE":"COLLÉE","ECARTE":"ÉCARTÉ","ECARTEE":"ÉCARTÉE","ELECTRISE":"ÉLECTRISÉ","ELECTRISEE":"ÉLECTRISÉE","EMPOISONNE":"EMPOISONNÉ","EMPOISONNEE":"EMPOISONNÉE","EPATE":"ÉPATÉ","EPATEE":"ÉPATÉE","EVAPORE":"ÉVAPORÉ","EVAPOREE":"ÉVAPORÉE","EXPLOSE":"EXPLOSÉ","EXPLOSEE":"EXPLOSÉE","FARCI":"FARCI","FARCIE":"FARCIE","FLAMBE":"FLAMBÉ","FLAMBEE":"FLAMBÉE","FRUSTRE":"FRUSTRÉ","FRUSTREE":"FRUSTRÉE","GRATINE":"GRATINÉ","GRATINEE":"GRATINÉE","IMBIBE":"IMBIBÉ","IMBIBEE":"IMBIBÉE","INTRIGUE":"INTRIGUÉ","INTRIGUEE":"INTRIGUÉE","JETE":"JETÉ","JETEE":"JETÉE","NETTOYE":"NETTOYÉ","NETTOYEE":"NETTOYÉE","POMPE":"POMPÉ","POMPEE":"POMPÉE","RAJEUNI":"RAJEUNI","RAJEUNIE":"RAJEUNIE","RECYCLE":"RECYCLÉ","RECYCLEE":"RECYCLÉE","SATURE":"SATURÉ","SATUREE":"SATURÉE","SOULAGE":"SOULAGÉ","SOULAGEE":"SOULAGÉE","STRESSE":"STRESSÉ","STRESSEE":"STRESSÉE","VACCINE":"VACCINÉ","VACCINEE":"VACCINÉE","VIDE":"VIDÉ","VIDEE":"VIDÉE","EMU":"ÉMU","EMUE":"ÉMUE","AIGRI":"AIGRI","AIGRIE":"AIGRIE","ANGOISSE":"ANGOISSÉ","ANGOISSEE":"ANGOISSÉE","AVACHI":"AVACHI","AVACHIE":"AVACHIE","BEURRE":"BEURRÉ","BEURREE":"BEURRÉE","CLAQUE":"CLAQUÉ","CLAQUEE":"CLAQUÉE","DUPE":"DUPÉ","DUPEE":"DUPÉE","JUCHE":"JUCHÉ","JUCHEE":"JUCHÉE","LEVE":"LEVÉ","LEVEE":"LEVÉE","LIGOTE":"LIGOTÉ","LIGOTEE":"LIGOTÉE","MUR":"MÛR","MURE":"MÛRE","OCCUPE":"OCCUPÉ","OCCUPEE":"OCCUPÉE","ORIGINAL":"ORIGINAL","ORIGINALE":"ORIGINALE","PULVERISE":"PULVÉRISÉ","PULVERISEE":"PULVÉRISÉE","RUSE":"RUSÉ","RUSEE":"RUSÉE","SIDERE":"SIDÉRÉ","SIDEREE":"SIDÉRÉE","ZAPPE":"ZAPPÉ","ZAPPEE":"ZAPPÉE","CLOUE":"CLOUÉ","CLOUEE":"CLOUÉE","FIGE":"FIGÉ","FIGEE":"FIGÉE","BUTE":"BUTÉ","BUTEE":"BUTÉE","FOIRE":"FOIRÉ","FOIREE":"FOIRÉE","LAVE":"LAVÉ","LAVEE":"LAVÉE","PUNI":"PUNI","PUNIE":"PUNIE","EGARE":"ÉGARÉ","EGAREE":"ÉGARÉE","EJECTE":"ÉJECTÉ","EJECTEE":"ÉJECTÉE","ZEBREE":"ZÉBRÉE","MUSCLE":"MUSCLÉ","MUSCLEE":"MUSCLÉE","BOUILLI":"BOUILLI","BOUILLIE":"BOUILLIE","AMOLLI":"AMOLLI","AMOLLIE":"AMOLLIE","VENTRU":"VENTRU","VENTRUE":"VENTRUE","CRADO":"CRADO","FRAGILE":"FRAGILE","AFFOLE":"AFFOLÉ","AFFOLEE":"AFFOLÉE","PANIQUE":"PANIQUÉ","PANIQUEE":"PANIQUÉE","TIMBRE":"TIMBRÉ","TIMBREE":"TIMBRÉE","ARROSE":"ARROSÉ","ARROSEE":"ARROSÉE","ESSORE":"ESSORÉ","ESSOREE":"ESSORÉE","ATTRISTE":"ATTRISTÉ","ATTRISTEE":"ATTRISTÉE","ETONNE":"ÉTONNÉ","ETONNEE":"ÉTONNÉE","ESPIEGLE":"ESPIÈGLE","DEBONNAIRE":"DÉBONNAIRE","SURREALISTE":"SURRÉALISTE","POMMELE":"POMMELÉ","POMMELEE":"POMMELÉE","GUINDE":"GUINDÉ","GUINDEE":"GUINDÉE","ENJOUE":"ENJOUÉ","ENJOUEE":"ENJOUÉE","DANDINE":"DANDINÉ","DANDINEE":"DANDINÉE","BARIOLE":"BARIOLÉ","BARIOLEE":"BARIOLÉE","MAGNETIQUE":"MAGNÉTIQUE","HARMONIEUX":"HARMONIEUX","HARMONIEUSE":"HARMONIEUSE","CHATOUILLE":"CHATOUILLÉ","CHATOUILLEE":"CHATOUILLÉE","BIGARRE":"BIGARRÉ","BIGARREE":"BIGARRÉE","ELEGANT":"ÉLÉGANT","ELEGANTE":"ÉLÉGANTE","IRRESISTIBLE":"IRRÉSISTIBLE","PRINCIERE":"PRINCIÈRE","DROLATIQUE":"DRÔLATIQUE"};
function displayWord(raw){const key=norm(raw);return DISPLAY_WORDS[key]||String(raw??"");}
function norm(s){return String(s??"").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}

/*
 * Canonicalisation COMPAT :
 * - casse et accents d'affichage ignorés ;
 * - espaces, apostrophes et tirets ignorés pour les mots radio ;
 * - l'ordre des entrées reste, lui, strictement significatif.
 */
function protocolToken(s){
  return String(s??"")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^A-Z0-9]/g,"");
}

function protocolCompatSpec(){
  return {
    compatSpecVersion:COMPAT_SPEC_VERSION,
    protocolId:PROTOCOL_ID,

    geometry:{
      sideKm:SIDE_KM,
      cellKm:CELL_KM,
      cellsPerSide:CELLS
    },

    payload:{
      domain:DOMAIN,
      tagBits:TAG_BITS,
      tagSpace:TAG_SPACE,
      subjectCount:SUBJECTS.length,
      qualifierCount:QUALS.length,
      connectors:[["ET",0],["OU",1]]
    },

    crypto:{
      kdf:"PBKDF2-SHA-256",
      kdfIterations:PBKDF2_ITERATIONS,
      kdfSaltPrefix:"VHF-GPS-MASTER|",
      hmac:"HMAC-SHA-256",
      feistelRounds:FEISTEL_ROUNDS,
      cycleWalkDomain:DOMAIN
    },

    zone:{
      protocolVersion:ZONE_PROTOCOL_VERSION,
      aliasVersion:ZONE_ALIAS_VERSION,
      ephemeralGridDeg:EPHEMERAL_GRID_DEG,
      ephemeralPublicAnchorMinKm:EPHEMERAL_PUBLIC_ANCHOR_MIN_KM,
      ephemeralEdgeMarginKm:EPHEMERAL_EDGE_MARGIN_KM,
      ephemeralSecretOffsetMaxKm:EPHEMERAL_SECRET_OFFSET_MAX_KM
    },

    algorithms:ALGORITHM_IDS,

    // Le libellé humain est volontairement exclu : seul l'id et le centre comptent.
    builtinZones:BUILTIN_ZONES.map(z=>[
      z.id,
      Number(Number(z.lat).toFixed(5)),
      Number(Number(z.lon).toFixed(5))
    ]),

    session:{
      secretAlphabet:[...new Set(SECRET_ALPHABET)].sort().join(""),
      secretRawLength:SECRET_RAW_LENGTH,
      fingerprintVersion:SESSION_FINGERPRINT_VERSION
    },

    // Catalogues qui influencent réellement ce qui est dit / interprété à la radio.
    subjects:SUBJECTS.map(s=>[protocolToken(s.w),s.g]),
    qualifiers:QUALS.map(q=>[protocolToken(q.m),protocolToken(q.f)]),
    fingerprintWords:FINGERPRINT_WORDS.map(protocolToken),
    natoWords:NATO_WORDS.map(protocolToken),
    ackWords:ACK_WORDS.map(protocolToken)
  };
}

let protocolCompatDigestPromise=null;

async function protocolCompatDigestHex(){
  if(protocolCompatDigestPromise)return protocolCompatDigestPromise;

  protocolCompatDigestPromise=(async()=>{
    if(!crypto?.subtle)throw new Error("Web Crypto indisponible pour le digest de compatibilité.");
    const canonical=JSON.stringify(protocolCompatSpec());
    const bytes=new TextEncoder().encode(canonical);
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    return [...digest].map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
  })();

  return protocolCompatDigestPromise;
}

async function initProtocolCompat(){
  try{
    const full=await protocolCompatDigestHex();
    const short=full.slice(0,8);
    const badge=$("compatBadge");
    const shortEl=$("compatShort");
    const fullEl=$("compatFull");
    if(badge)badge.textContent=`COMPAT ${short}`;
    if(shortEl)shortEl.textContent=`${protocolShortLabel()} · COMPAT ${short}`;
    if(fullEl)fullEl.textContent=full;
  }catch(e){
    const badge=$("compatBadge");
    if(badge)badge.textContent="COMPAT ?";
    const shortEl=$("compatShort");
    const fullEl=$("compatFull");
    if(shortEl)shortEl.textContent="Digest indisponible";
    if(fullEl)fullEl.textContent=e.message||String(e);
  }
}
function parseNum(v){
  const s=String(v??"").trim();
  return s===""?NaN:Number(s.replace(",","."));
}
function fmt(n,d=1){return Number(n).toFixed(d).replace(".",",");}

const POSITION_INPUT_MODE_KEY="vhfGpsPositionInputModeV1";
let positionInputMode=appStorage.getItem(POSITION_INPUT_MODE_KEY)==="decimal"?"decimal":"marine";
let positionUiSyncing=false;
let senderGpsRevision=0;

function decimalAxisToDdm(value,isLat){
  if(!Number.isFinite(value))return null;

  const max=isLat?90:180;
  if(value<-max||value>max)return null;

  const abs=Math.abs(value);
  let deg=Math.floor(abs);
  let min=(abs-deg)*60;

  min=Number(min.toFixed(3));
  if(min>=60){
    deg+=1;
    min=0;
  }

  return{
    deg,
    min,
    hem:isLat?(value>=0?"N":"S"):(value>=0?"E":"W")
  };
}

function parseDdmAxis(degId,minId,hemId,isLat){
  const degRaw=String($(degId).value??"").trim();
  const minRaw=String($(minId).value??"").trim();
  const hem=$(hemId).value;
  const axisName=isLat?"latitude":"longitude";
  const max=isLat?90:180;
  const allowed=isLat?["N","S"]:["E","W"];

  if(!degRaw&&!minRaw)return{ok:false,empty:true,error:`Saisis la ${axisName}.`};
  if(!degRaw||!minRaw)return{ok:false,empty:false,error:`${axisName[0].toUpperCase()+axisName.slice(1)} incomplète : degrés et minutes sont requis.`};
  if(degRaw.startsWith("-")||minRaw.startsWith("-")){
    return{ok:false,empty:false,error:`En mode marine, utilise ${isLat?"N/S":"E/W"} plutôt qu’un signe négatif.`};
  }

  const deg=parseNum(degRaw),min=parseNum(minRaw);

  if(!Number.isFinite(deg)||!Number.isInteger(deg)||deg<0||deg>max){
    return{ok:false,empty:false,error:`Degrés de ${axisName} invalides (0 à ${max}).`};
  }
  if(!Number.isFinite(min)||min<0||min>=60){
    return{ok:false,empty:false,error:`Minutes de ${axisName} invalides (0 à moins de 60).`};
  }
  if(deg===max&&min!==0){
    return{ok:false,empty:false,error:`À ${max}°, les minutes doivent être 0.`};
  }
  if(!allowed.includes(hem)){
    return{ok:false,empty:false,error:`Indique ${isLat?"N ou S":"E ou W"}.`};
  }

  const sign=(hem==="S"||hem==="W")?-1:1;
  return{ok:true,value:sign*(deg+min/60),deg,min,hem};
}

function readMarinePosition(){
  const latPart=parseDdmAxis("latDeg","latMin","latHem",true);
  const lonPart=parseDdmAxis("lonDeg","lonMin","lonHem",false);

  if(!latPart.ok)return{ok:false,empty:latPart.empty&&lonPart.empty,error:latPart.error};
  if(!lonPart.ok)return{ok:false,empty:false,error:lonPart.error};

  return{ok:true,lat:latPart.value,lon:lonPart.value};
}

function readActivePosition(){
  if(positionInputMode==="marine"){
    return readMarinePosition();
  }

  const lat=parseNum($("lat").value),lon=parseNum($("lon").value);
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
    return{
      ok:false,
      empty:!Number.isFinite(lat)&&!Number.isFinite(lon),
      error:"Coordonnées décimales invalides : latitude -90 à 90, longitude -180 à 180."
    };
  }

  return{ok:true,lat,lon};
}

function setMarineFromDecimal(lat,lon){
  const a=decimalAxisToDdm(lat,true),b=decimalAxisToDdm(lon,false);
  if(!a||!b)return false;

  positionUiSyncing=true;
  $("latDeg").value=String(a.deg).padStart(2,"0");
  $("latMin").value=a.min.toFixed(3);
  $("latHem").value=a.hem;
  $("lonDeg").value=String(b.deg).padStart(3,"0");
  $("lonMin").value=b.min.toFixed(3);
  $("lonHem").value=b.hem;
  positionUiSyncing=false;
  return true;
}

function setDecimalPosition(lat,lon,{updateMarine=true}={}){
  positionUiSyncing=true;
  $("lat").value=Number.isFinite(lat)?lat.toFixed(6):"";
  $("lon").value=Number.isFinite(lon)?lon.toFixed(6):"";
  positionUiSyncing=false;

  if(updateMarine&&Number.isFinite(lat)&&Number.isFinite(lon)){
    setMarineFromDecimal(lat,lon);
  }
  updatePositionCanonicalPreview(lat,lon);
}

function updatePositionCanonicalPreview(lat,lon){
  const el=$("positionCanonicalPreview");
  if(!el)return;

  if(!Number.isFinite(lat)||!Number.isFinite(lon)){
    el.innerHTML="Saisis les degrés, les minutes décimales et <strong>N/S · E/W</strong>.";
    return;
  }

  el.innerHTML=`Interne : <strong>${lat.toFixed(6)} / ${lon.toFixed(6)}</strong> · ${formatDegMin(lat,true)} / ${formatDegMin(lon,false)}`;
}

function marineFieldsAreEmpty(){
  return !String($("latDeg").value||"").trim() &&
         !String($("latMin").value||"").trim() &&
         !String($("lonDeg").value||"").trim() &&
         !String($("lonMin").value||"").trim();
}

function refreshPositionHemisphereDefaults(){
  if(!marineFieldsAreEmpty())return;
  const z=activeZone();
  if(!z)return;

  $("latHem").value=z.lat>=0?"N":"S";
  $("lonHem").value=z.lon>=0?"E":"W";
}

function setPositionInputMode(mode,{persist=true}={}){
  senderGpsRevision++;
  positionInputMode=mode==="decimal"?"decimal":"marine";
  if(persist)appStorage.setItem(POSITION_INPUT_MODE_KEY,positionInputMode);

  const marine=positionInputMode==="marine";
  $("marinePositionInput").classList.toggle("hidden",!marine);
  $("decimalPositionInput").classList.toggle("hidden",marine);

  $("positionModeMarine").classList.toggle("active",marine);
  $("positionModeDecimal").classList.toggle("active",!marine);
  $("positionModeMarine").setAttribute("aria-pressed",String(marine));
  $("positionModeDecimal").setAttribute("aria-pressed",String(!marine));

  if(marine){
    const lat=parseNum($("lat").value),lon=parseNum($("lon").value);
    if(Number.isFinite(lat)&&Number.isFinite(lon))setMarineFromDecimal(lat,lon);
    else refreshPositionHemisphereDefaults();
  }else{
    const m=readMarinePosition();
    if(m.ok)setDecimalPosition(m.lat,m.lon,{updateMarine:false});
  }
  handlePositionChanged();
}

function handlePositionChanged(){
  invalidateEncodedResult();
  checkDrift();
  refreshEphemeralWorkflow();
}

function syncPositionFromMarine(){
  if(positionUiSyncing)return;
  senderGpsRevision++;

  const p=readMarinePosition();
  if(!p.ok){
    positionUiSyncing=true;
    $("lat").value="";
    $("lon").value="";
    positionUiSyncing=false;
    updatePositionCanonicalPreview(NaN,NaN);

    if(p.empty){
      setDriftStatus("Entre une position pour vérifier sa dérive par rapport au centre virtuel.","warn");
    }else{
      setDriftStatus(p.error,"bad");
    }

    invalidateEncodedResult();
    refreshEphemeralWorkflow();
    return;
  }

  setDecimalPosition(p.lat,p.lon,{updateMarine:false});
  handlePositionChanged();
}

function syncPositionFromDecimal(){
  if(positionUiSyncing)return;
  senderGpsRevision++;

  const lat=parseNum($("lat").value),lon=parseNum($("lon").value);
  const valid=Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180;

  if(!valid){
    updatePositionCanonicalPreview(NaN,NaN);
    setDriftStatus("Coordonnées décimales invalides : latitude -90 à 90, longitude -180 à 180.","bad");
    invalidateEncodedResult();
    refreshEphemeralWorkflow();
    return;
  }

  setMarineFromDecimal(lat,lon);
  updatePositionCanonicalPreview(lat,lon);
  handlePositionChanged();
}

function initPositionInputUi(){
  refreshPositionHemisphereDefaults();
  setPositionInputMode(positionInputMode,{persist:false});
}

const ZONE_CENTER_INPUT_MODE_KEY="vhfGpsZoneCenterInputModeV1";
let zoneCenterInputMode=appStorage.getItem(ZONE_CENTER_INPUT_MODE_KEY)==="decimal"?"decimal":"marine";
let zoneCenterUiSyncing=false;
let centerGpsRevision=0;

function readMarineZoneCenter(){
  const latPart=parseDdmAxis("zoneLatDeg","zoneLatMin","zoneLatHem",true);
  const lonPart=parseDdmAxis("zoneLonDeg","zoneLonMin","zoneLonHem",false);

  if(!latPart.ok)return{ok:false,empty:latPart.empty&&lonPart.empty,error:latPart.error};
  if(!lonPart.ok)return{ok:false,empty:false,error:lonPart.error};

  return{ok:true,lat:latPart.value,lon:lonPart.value};
}

function readActiveZoneCenter(){
  if(zoneCenterInputMode==="marine"){
    return readMarineZoneCenter();
  }

  const lat=parseNum($("zoneLat").value),lon=parseNum($("zoneLon").value);
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
    return{
      ok:false,
      empty:!Number.isFinite(lat)&&!Number.isFinite(lon),
      error:"Centre décimal invalide : latitude -90 à 90, longitude -180 à 180."
    };
  }

  return{ok:true,lat,lon};
}

function setZoneCenterMarineFromDecimal(lat,lon){
  const a=decimalAxisToDdm(lat,true),b=decimalAxisToDdm(lon,false);
  if(!a||!b)return false;

  zoneCenterUiSyncing=true;
  $("zoneLatDeg").value=String(a.deg).padStart(2,"0");
  $("zoneLatMin").value=a.min.toFixed(3);
  $("zoneLatHem").value=a.hem;
  $("zoneLonDeg").value=String(b.deg).padStart(3,"0");
  $("zoneLonMin").value=b.min.toFixed(3);
  $("zoneLonHem").value=b.hem;
  zoneCenterUiSyncing=false;
  return true;
}

function updateZoneCenterCanonicalPreview(lat,lon){
  const el=$("zoneCenterCanonicalPreview");
  if(!el)return;

  if(!Number.isFinite(lat)||!Number.isFinite(lon)){
    el.innerHTML="Saisis les degrés, les minutes décimales et <strong>N/S · E/W</strong>.";
    return;
  }

  el.innerHTML=`Interne : <strong>${lat.toFixed(6)} / ${lon.toFixed(6)}</strong> · ${formatDegMin(lat,true)} / ${formatDegMin(lon,false)}`;
}

function setZoneCenterDecimal(lat,lon,{updateMarine=true}={}){
  zoneCenterUiSyncing=true;
  $("zoneLat").value=Number.isFinite(lat)?lat.toFixed(6):"";
  $("zoneLon").value=Number.isFinite(lon)?lon.toFixed(6):"";
  zoneCenterUiSyncing=false;

  if(updateMarine&&Number.isFinite(lat)&&Number.isFinite(lon)){
    setZoneCenterMarineFromDecimal(lat,lon);
  }
  updateZoneCenterCanonicalPreview(lat,lon);
}

function setZoneCenterInputMode(mode,{persist=true}={}){
  centerGpsRevision++;
  zoneCenterInputMode=mode==="decimal"?"decimal":"marine";
  if(persist)appStorage.setItem(ZONE_CENTER_INPUT_MODE_KEY,zoneCenterInputMode);

  const marine=zoneCenterInputMode==="marine";
  $("zoneCenterMarineInput").classList.toggle("hidden",!marine);
  $("zoneCenterDecimalInput").classList.toggle("hidden",marine);

  $("zoneCenterModeMarine").classList.toggle("active",marine);
  $("zoneCenterModeDecimal").classList.toggle("active",!marine);
  $("zoneCenterModeMarine").setAttribute("aria-pressed",String(marine));
  $("zoneCenterModeDecimal").setAttribute("aria-pressed",String(!marine));

  if(marine){
    const lat=parseNum($("zoneLat").value),lon=parseNum($("zoneLon").value);
    if(Number.isFinite(lat)&&Number.isFinite(lon)){
      setZoneCenterMarineFromDecimal(lat,lon);
      updateZoneCenterCanonicalPreview(lat,lon);
    }
  }else{
    const p=readMarineZoneCenter();
    if(p.ok)setZoneCenterDecimal(p.lat,p.lon,{updateMarine:false});
  }
}

function syncZoneCenterFromMarine(){
  if(zoneCenterUiSyncing)return;
  centerGpsRevision++;

  const p=readMarineZoneCenter();
  if(!p.ok){
    zoneCenterUiSyncing=true;
    $("zoneLat").value="";
    $("zoneLon").value="";
    zoneCenterUiSyncing=false;
    updateZoneCenterCanonicalPreview(NaN,NaN);

    if(!p.empty)setStatus("zoneStatus",p.error,"bad");
    return;
  }

  setZoneCenterDecimal(p.lat,p.lon,{updateMarine:false});
  hideStatus("zoneStatus");
}

function syncZoneCenterFromDecimal(){
  if(zoneCenterUiSyncing)return;
  centerGpsRevision++;

  const lat=parseNum($("zoneLat").value),lon=parseNum($("zoneLon").value);
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
    updateZoneCenterCanonicalPreview(NaN,NaN);
    setStatus("zoneStatus","Centre décimal invalide : latitude -90 à 90, longitude -180 à 180.","bad");
    return;
  }

  setZoneCenterMarineFromDecimal(lat,lon);
  updateZoneCenterCanonicalPreview(lat,lon);
  hideStatus("zoneStatus");
}

function initZoneCenterInputUi(){
  setZoneCenterInputMode(zoneCenterInputMode,{persist:false});
}


const SESSION_SECRET_KEY="vhfGpsSessionSecretV312";
const SESSION_CREATED_AT_KEY="vhfGpsSessionCreatedAtV312";
const OUTING_ID_KEY="vhfGpsOutingIdV1";
const OUTING_INSTALLED_AT_KEY="vhfGpsOutingInstalledAtV1";
const OUTING_ORIGIN_KEY="vhfGpsOutingOriginV1";
let pendingOutingImport=null;
let outingImportRevision=0;
let outingActionRevision=0;
let outingMutationBusy=false;
let outingCopyBusy=false;
let outingShareRevision=0;
let outingShareReady=null;
let outingCheckBusy=false;
let outingSetupRevision=0;
let outingSuccessTimer=null;
let outingZoneType="builtin";
let outingPositionMode="marine";
let pendingOutingCreation=null;
const SECRET_ALPHABET="23456789ABCDEFGHJKMNPQRSTVWXYZ";
const SECRET_RAW_LENGTH=28;
const RESERVED_PROTOCOL_TEST_SECRET="2345678-9ABCDEF-GHJKMNP-QRSTVWX";
// Catalogue radio PROTO 6 : 1024 mots distincts, sans signaux de détresse ni directions cardinales.
const FINGERPRINT_WORDS=["ABLETTE","AIGLEFIN","ALOSE","ANCHOIS","ANGUILLE","ANGUILLETTE","BALISTE","ORIGAMI","BARBUE","BAUDROIE","BONITE","BOUQUET","BRÈME","BROCHET","CABILLAUD","CAPELAN","CARANGUE","CARPE","CHABOT","CHINCHARD","CIVELLE","CONGRE","CORB","CORBINE","DORADE","ÉGLEFIN","ÉPERLAN","ESPADON","ESTURGEON","FLET","FLETAN","GOBIE","GRENADIER","GRONDIN","HARENG","JULIENNE","LAMPROIE","LIEU","LIMANDE","LINGUE","LOTTE","MAIGRE","MAQUEREAU","MARLIN","MERLAN","MERLU","MÉROU","MULET","MURÈNE","ORPHIE","PAGEOT","PAGRE","PLIE","POISSON-LUNE","RAIE","RASCASSE","REQUIN","ROUGET","SABRE","SAINT-PIERRE","SANDRE","TAMARIS","SARDINE","SAUMON","SCORPÈNE","DAHLIA","SPRAT","TACAUD","TARPON","THAZARD","THON","TILAPIA","TURBOT","VIEILLE","VIVANEAU","VIVE","ANÉMONE","ARAIGNÉE","BIGORNEAU","BULOT","CALAMAR","CALMARIN","CAPRELLA","COQUE","COQUILLE","COQUILLAGE","COUTEAU","CRABE","CREVETTE","CRUSTACÉ","DORIS","ÉPONGE","ÉTOILE","GAMBA","HOMARD","HOLOTHURIE","HUÎTRE","LANGOUSTE","LANGOUSTINE","LITTORINE","MÉDUSE","MOLLUSQUE","MOULE","NACRE","NAUTILE","ORMEAU","OURLIN","PALOURDE","PATELLE","PIEUVRE","POULPE","PRAIRE","SEICHE","SIPHON","SQUILLE","TOURTEAU","TROQUE","VERNIS","OURSIN","CORAIL","GORGONE","ASCIDIE","BRYOZOAIRE","BERNARD","PAGURE","BRANCHIOPE","AMPHIPODE","COPEPODE","KRILL","PLANCTON","PHYTOPLANCTON","ZOOPLANCTON","CTENOPHORE","SIPHONOPHORE","SPONGIAIRE","MANTEAU","TENTACULE","VENTOUSE","CARAPACE","PINCE","NACELLE","BALEINE","BÉLUGA","CACHALOT","CÉTACÉ","DAUPHIN","DUGONG","GLOBICÉPHALE","LAMENTIN","MARSOUIN","NARVAL","ORQUE","PHOQUE","MORSE","OTARIE","RORQUAL","SIRENIEN","TORTUE","CARET","CAOUANNE","LUTH","BALEINEAU","DAUPHINEAU","VELELLE","ALBATROS","ALCIDE","AIGRETTE","AVOCETTE","BÉCASSEAU","BERGERONNETTE","CORMORAN","COURLIS","ECHASSE","FOU","FULMAR","GOÉLAND","GRAND LABBE","GRÈBE","GUILLEMOT","HÉRON","HUÎTRIER","LABBE","MACAREUX","MOUETTE","OCÉANITE","PÉLICAN","PÉTREL","PLONGEON","PUFFIN","STERNE","TOURNEPIERRE","PINGOUIN","GRAVELOT","GARROT","HARLE","GABIAN","FLAMANT","IBIS","MAROUETTE","CHEVALIER","BARGE","SPATULE","VANNEAU","TADORNE","CANARD","OIE","FULIGULE","SARCELLE","ANNEXE","JACARANDA","BATEAU","BATELIER","CANOT","CATAMARAN","CHALAND","CHALOUPE","CHALUTIER","COTRE","DRAGUEUR","FERRY","GABARE","GALION","GOÉLETTE","HYDROGLISSEUR","KAYAK","LANGOUSTIER","NAVIRE","PAILLEBOT","PAQUEBOT","PATROUILLEUR","PÉNICHE","PIROGUE","PORTE-CONTENEURS","REMORQUEUR","SARDINIER","SEMI-RIGIDE","SKIFF","THONIER","TRIMARAN","VEDETTE","VOILIER","YACHT","ZODIAC","FLIBOTTE","FRIGATE","CORVETTE","CARGO","PÉTROLIER","GAZIER","ROULIER","VRAQUIER","PORTE-AVIONS","SOUS-MARIN","GOÉMONIER","CASEYEUR","FILEYEUR","SENNEUR","PALANGRIER","KETCH","SLOOP","PRAO","ACCASTILLAGE","AILERON","ANCRE","ARCEAU","BALLAST","BARRE","BARROT","BASTINGAGE","TOURNESOL","BÔME","BORD","BORDAGE","BOUCHAIN","CABINE","CALE","CARÈNE","COCKPIT","DALOT","DAVIER","DÉRIVE","ÉCUBIER","ÉPONTILLE","ÉTRAVE","FILIÈRE","FRANC-BORD","GÎTE","GOUVERNAIL","GRÉEMENT","HILOIRE","HUBLOT","JUPE","QUILLE","LISTON","MÂTURE","PAVOIS","PLANCHER","PONT","POUPE","PROUE","RAIL","ROOF","SAFRAN","TABLEAU","TAMBOUR","TAQUET","VARANGUE","VERGUE","VIT-DE-MULET","SUPERSTRUCTURE","PASSERELLE","CHANDELIER","PORTIÈRE","SABORD","ÉCHELLE","ÉCOUTILLE","CAPOT","DESCENTE","COMPARTIMENT","PUITS","COFFRE","BAILLE","COQUERON","CLOISON","MEMBRURE","LISSAGE","ÉTAMBOT","ÉTRIER","BOSSOIR","PORTIQUE","CAILLEBOTIS","PLATEFORME","AMURE","ARISER","AULOFFÉE","AUSSIÈRE","BALANCINE","BASTAQUE","BONNETTE","BORDER","BRASSER","CHUTE","CHOQUER","CUNNINGHAM","DRISSE","ÉCOUTE","EMPANNAGE","ENROULEUR","ÉTAI","ÉTARQUER","FASEYER","FOC","GALHAUBAN","GÉNOIS","GRAND-VOILE","GUINDANT","HAUBAN","HISSER","LATTE","LOFER","MOUFLAGE","PALAN","PATARAS","RALINGUE","RIS","SOUS-BARBE","SPI","SPINNAKER","TANGON","TRINQUETTE","VAIGRE","YANKEE","AFFALER","AMARRER","BOULINE","BRAS","CABLOT","CORNOUAILLE","EMPOINTURE","ENVERGURE","GARDE","GARDETTE","HALER","LARGUER","LOVER","MANILLE","MOUILLER","PANTOIRE","POULIE","RIDOIR","TAUD","TIREVEILLE","TOURMENTIN","VAIGRAGE","VERIN","WINCH","ALTERNATEUR","BATTERIE","BOUCHON","BOUGIE","CARBURANT","CARBURATEUR","CARDAN","COMPRESSEUR","COUPE-BATTERIE","DÉMARREUR","DIESEL","DURITE","ÉCHAPPEMENT","EMBRAYAGE","FILTRE","GASOIL","HÉLICE","HUILE","INJECTEUR","INJECTION","INVERSEUR","MOTEUR","POMPE","RÉSERVOIR","TRANSMISSION","TURBO","VOLANT","ARBRE","ANODE","AQUADRIVE","CHAINE","COURROIE","ÉCHANGEUR","ÉCROU","EMBASE","FLAP","FLOTTEUR","FUSIBLE","GÉNÉRATRICE","JAUGE","LUBRIFIANT","MANETTE","PROPULSEUR","RADIATEUR","RÉDUCTEUR","REFROIDISSEMENT","ROTOR","STATOR","SONDE","VENTILATEUR","VOLTMETRE","AMPÈREMÈTRE","CHARGEUR","CONVERTISSEUR","ONDULEUR","CONTACTEUR","RELAIS","APPÂT","BAS DE LIGNE","BICHETTE","BOBINE","BOURRICHE","CANNE","CASIER","ÉPUISETTE","FIL","GAFFE","GRELOT","HAMEÇON","LEURRE","LIGNE","LEST","MOULINET","PLOMB","RAPALA","TRESSE","VIVIER","AMORCE","AMORCAGE","AVANCON","BOUILLETTE","BULDO","CAGE","CHARIOT","COLLIER","CRIN","CUILLÈRE","ÉMERILLON","FLOTTE","HARPON","JIG","JIGGING","LAME","LANCER","MITRAILLETTE","NYLON","PATER-NOSTER","PLUME","POPPER","SABIKI","SHAD","SPINNER","TURLUTTE","VIBRATION","STREAMER","MOUCHE","ÉVENTAIL","TÊTE-PLOMBÉE","AGRAFE","ÉPINGLE","CISEAUX","DÉGORGEOIR","DÉCROCHEUR","PESON","SACOCHE","GLACIÈRE","SEAU","CAISSE","FILET","ÉPERVIER","SENNE","PALANGRE","CHALUT","DRAILLE","TREMMAIL","VERVEUX","NASSE","HAVENEAU","CARRELET","BOLINCHE","DRAGUE","ANIMER","APPÂTER","BRIDER","CALER","CHALUTER","COMBATTRE","DÉCROCHER","DÉRIVER","ÉCHOUER","FERRER","FILER","FOUETTER","GUETTER","JIGGER","LEURRER","PALANGRER","PÊCHER","PIQUER","REMONTER","RELÂCHER","RAMENER","SERRER","SONDER","TROLLER","TRAQUER","TREUILLER","VIRER","AMORCER","CAPTURER","MAILLER","DÉMAILLER","TRIER","GLACER","EMBARQUER","DÉBARQUER","RELEVER","REJETER","POCHER","ÉCALER","ÉCAILLER","ÉVISCÉRER","SAIGNER","CONSERVER","CONGELER","FUMER","SALER","ABATTRE","ALIGNEMENT","AMER","ALLURE","AZIMUT","BÂBORD","BALISAGE","CAP","CARDINALE","CARTE","COMPAS","COURANT","DISTANCE","ESTIME","GRENADINE","GYROCOMPAS","LOCH","MÉRIDIEN","MILLE","NAVIGATION","PÉRISCOPE","SAXOPHONE","RHINOCÉROS","QUADRILLAGE","POSITION","RADAR","RELÈVEMENT","ROUTE","SECTEUR","SONDEUR","TRIBORD","WAYPOINT","LATITUDE","LONGITUDE","COORDONNÉE","TRACEUR","PILOTE","AUTOMATIQUE","CARTOGRAPHIE","PROFONDEUR","VITESSE","NŒUD","MOUVEMENT","VEILLE","QUART","RELACHE","ESCALE","CABOTAGE","HAUTURIER","CÔTIER","TRANSIT","PASSAGE","CHENAL","DÉTROIT","RADE","ABRI","MOUILLAGE","APPROCHE","ATTERRISSAGE","ALIGNER","CORRIGER","REPÉRER","ORIENTER","POINTER","ROUTER","NAVIGUER","CROISER","ÉVITER","DÉPASSER","RATTRAPER","VIRAGE","GIRATION","ECHO","CPA","TCPA","IGLOO","HARMONICA","NAVTEX","ACCORDÉON","BIBERON","FARANDOLE","JONQUILLE","KANGOUROU","BALISE","BOUÉE","PHARE","FEU","LATÉRALE","SPÉCIAL","MARQUE","TOURELLE","ESPAR","PERCHETTE","PORT","AVANT-PORT","ARRIÈRE-PORT","BASSIN","DARSE","ÉCLUSE","JETÉE","DIGUE","CERISIER","QUAI","PONTON","MARINA","CAPITAINERIE","CRIÉE","DOUANE","GRUE","BITTE","BOLLARD","ANNEAU","AMARRE","CHAUMARD","DÉFENSE","PAREBATTAGE","CATWAY","DOCK","TERMINAL","HANGAR","ENTREPÔT","SILO","RAMPE","SLIPWAY","ESTACADE","APPONTEMENT","DÉBARCADÈRE","EMBARCADÈRE","CHANTIER","CALE-SÈCHE","RADOUB","FORMELLE","BASSINAGE","DRAGAGE","DÉPÔT","PÊCHEUR","HALLE","POISSONNERIE","MARÉEYEUR","PORTUAIRE","GARDIEN","LAMANEUR","REMORQUAGE","AVITAILLEMENT","POTENCE","LEVAGE","ALIZÉ","ANTICYCLONE","AVERSE","BEAUFORT","BRUME","BROUILLARD","BRUINE","CIEL","CIRRUS","CUMULUS","DÉPRESSION","ÉCLAIR","ÉCLAIRCIE","FRONT","GIBOULÉE","GRAIN","GRÊLE","ISOBARE","MÉTÉO","NEIGE","NUAGE","ORAGE","PLUIE","PRESSION","RAFALE","TEMPÉRATURE","TEMPÊTE","TONNERRE","VENT","VISIBILITÉ","ZÉPHYR","BRISE","MISTRAL","TRAMONTANE","SIROCCO","MARIN","PONANT","LEVANT","NOROIT","SUROIT","LIBECCIO","GRÉCALE","BORA","HARMATTAN","MOUSSON","CYCLONE","OURAGAN","TORNADE","SQUALL","HUMIDITÉ","ROSÉE","CONDENSATION","ÉVAPORATION","CHALEUR","FROID","GEL","GIVRE","EMBRUN","VAPEUR","SOLEIL","LUNE","AUBE","CRÉPUSCULE","HORIZON","BAROMÈTRE","ANÉMOMÈTRE","THERMOMÈTRE","SATELLITE","BULLETIN","PRÉVISION","VIGILANCE","ABYSSE","BAIE","BANC","BATHYMETRIE","BRISANT","CLAPOT","CRIQUE","ÉCUME","ESTUAIRE","ESTRAN","FALAISE","FJORD","FLOT","FOSSE","GOLFE","GOULET","HAUT-FOND","HOULE","ÎLOT","JUSANT","LAGON","LAGUNE","LARGE","LITTORAL","MARNAGE","MARÉE","MER","OCÉAN","PLAGE","PLATEAU","RÉCIF","RESSAC","RIVAGE","ROCHE","SABLE","VAGUE","VASIÈRE","ANSE","ARCHIPEL","ATOLL","CÔTE","CORDON","DUNE","GRAVELEUX","GALET","GRÈVE","LIMAN","LIDO","MANGROVE","MARAIS","PASSE","PERTUIS","POINTE","PRESQU’ÎLE","RAZ","ROCHER","VARECH","HERBIER","POSIDONIE","ALGUE","GOÉMON","LAMINAIRE","SARGASSE","ZOSTERE","KELP","TOMBOLO","DELTA","EMBOUCHURE","CONFLUENCE","SOURCE","LARGEUR","SURFACE","FOND","PÉLAGIQUE","BENTHIQUE","OCÉANIQUE","MARITIME","INSULAIRE","LAGUNAIRE","LIBELLULE","BRASSIÈRE","COMBINAISON","FUSÉE","GILET","HARNAIS","ESCABEAU","RADEAU","XYLOPHONE","WAGON","MARGUERITE","YOGOURT","SIFFLET","BALANÇOIRE","CARROUSEL","MOSAÏQUE","KIOSQUE","ORANGEADE","ZIGZAG","NAPPERON","FUMÉE","ASSÈCHEMENT","ÉCOPE","OLIVIER","VIOLONCELLE","PARAPLUIE","QUENOUILLE","TAMBOURIN","ROULOTTE","SALOPETTE","LIGNE DE VIE","LONGE","MOUSQUETON","PHARMACIE","TROUSSE","COUVERTURE","LAMPE","PROJECTEUR","TORCHE","MIROIR","SIGNAL","PAVILLON","CORNE","SIRÈNE","KLAXON","RADIO","CANAL","TRANSPONDEUR","RÉFLECTEUR","AMIRAL","ARMATEUR","BOSCO","CAPITAINE","CHARPENTIER","COMMIS","CUISINIER","DOCKER","GABIER","MATELOT","MÉCANICIEN","MOUSSE","NAVIGATEUR","PATRON","PLONGEUR","QUARTIER-MAÎTRE","SAUVETEUR","SCAPHANDRIER","SKIPPER","TIMONIER","ÉQUIPAGE","ÉQUIPIER","PASSAGER","SECOND","MAÎTRE","OFFICIER","OPÉRATEUR","GRUTIER","CARRENEUR","CHAURONNIER","VOILERIE","FILETIER","POISSONNIER","OSTRÉICULTEUR","MYTILICULTEUR","AQUACULTEUR","CONCHYLICULTEUR","PILOTINE","VEILLEUR","MÉCANO","APNÉE","BOUTEILLE","DÉTENDEUR","MASQUE","PALME","TUBA","LESTAGE","OCTOPUS","MANOMETRE","PROFONDIMÈTRE","PARACHUTE","PALANQUÉE","PLONGÉE","REMONTÉE","IMMERSION","DÉCOMPRESSION","PALIER","NITROX","AIR","OXYGÈNE","HÉLIUM","TRIMIX","REBREATHER","SCAPHANDRE","CAMÉRA","CAISSON","ÉPAVE","GROTTE","TOMBANT","SNORKELING","PADDLE","SURF","PLANCHE","KITESURF","WINDSURF","VOILE","RÉGATE","CROISIÈRE","PLAISANCE","NAUTISME","BAIGNADE","NAGE","RANDONNÉE","PALMÉE","HIPPOCAMPE","ROUSSETTE","ÉMISSOLE","AIGUILLAT","PASTENAGUE","TORPILLE","OBLADE","SAUPE","GIRELLE","LABRE","SÉRIOLE","CASTAGNOLE","ÉTRILLE","PÉTONCLE","TELLINE","BERNIQUE","CABESTAN","BARBOTIN","ÉTALE","VIVE-EAU","MORTE-EAU","LOF"];
const NATO_WORDS=["ALFA","BRAVO","CHARLIE","DELTA","ECHO","FOXTROT","GOLF","HOTEL","INDIA","JULIETT","KILO","LIMA","MIKE","NOVEMBER","OSCAR","PAPA","QUEBEC","ROMEO","SIERRA","TANGO","UNIFORM","VICTOR","WHISKEY","X-RAY","YANKEE","ZULU"];

let masterKeyCache={secret:"",key:null};
let validatedSessionSecret="";
let activeSessionRevision=0;

function secureRandomIndex(max){
  if(!crypto?.getRandomValues)throw new Error("Générateur cryptographique indisponible.");
  const limit=Math.floor(0x100000000/max)*max;
  const a=new Uint32Array(1);
  do{crypto.getRandomValues(a);}while(a[0]>=limit);
  return a[0]%max;
}

function generateSessionSecret(){
  while(true){
    let raw="";
    for(let i=0;i<SECRET_RAW_LENGTH;i++)raw+=SECRET_ALPHABET[secureRandomIndex(SECRET_ALPHABET.length)];
    const secret=raw.match(/.{1,7}/g).join("-");
    if(secret!==RESERVED_PROTOCOL_TEST_SECRET)return secret;
  }
}

function canonicalSessionSecret(v){
  const raw=String(v??"").replace(/[\s-]+/g,"").toUpperCase();
  if(raw.length!==SECRET_RAW_LENGTH)return null;
  for(const c of raw)if(!SECRET_ALPHABET.includes(c))return null;
  return raw.match(/.{1,7}/g).join("-");
}

function validateSessionSecret(v){
  const canonical=canonicalSessionSecret(v);
  if(!canonical){
    return {ok:false,msg:"Secret invalide : 28 caractères attendus, alphabet sans 0/O ni 1/I/L."};
  }
  const bits=SECRET_RAW_LENGTH*Math.log2(SECRET_ALPHABET.length);
  return {ok:true,canonical,bits,msg:`Secret valide (~${bits.toFixed(1)} bits d'entropie s'il a été généré par l'application).`};
}

function validateOperationalSessionSecret(v){
  const result=validateSessionSecret(v);
  if(!result.ok)return result;

  if(result.canonical===RESERVED_PROTOCOL_TEST_SECRET){
    return{
      ok:false,
      canonical:result.canonical,
      msg:"Secret réservé à l’autotest du protocole — génère ou colle un autre secret de session."
    };
  }

  return result;
}

function activeSecret(){return validatedSessionSecret;}

function sessionCreatedAt(){
  const n=Number(appStorage.getItem(SESSION_CREATED_AT_KEY)||0);
  return Number.isFinite(n)&&n>0?n:0;
}

function sessionAgeText(){
  const created=sessionCreatedAt();
  if(!created)return "Date de création inconnue.";
  const ageH=(Date.now()-created)/3600000;
  const date=new Date(created).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"});
  return ageH>=24?`Créée le ${date} — session > 24 h : régénération recommandée.`:`Créée le ${date} — session récente.`;
}

function syncSavedSecret(secret){
  const v=secret?validateOperationalSessionSecret(secret):{ok:false};
  const nextSecret=v.ok?v.canonical:"";
  if(nextSecret!==validatedSessionSecret){
    activeSessionRevision++;
    clearOutingShare();
  }
  validatedSessionSecret=nextSecret;
  masterKeyCache={secret:"",key:null};
  $("sessionCompactStatus").textContent=validatedSessionSecret
    ?`Session active · ${sessionAgeText()}`
    :"Aucune session active.";
  refreshEncodeState();
  if(typeof refreshOutingActions==="function")refreshOutingActions();
}

async function deriveMasterKey(secret){
  const v=validateSessionSecret(secret);
  if(!v.ok)throw new Error("Secret de session invalide.");
  const s=v.canonical;
  if(masterKeyCache.key&&masterKeyCache.secret===s)return masterKeyCache.key;
  if(!crypto?.subtle)throw new Error("Web Crypto indisponible.");

  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(s),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({
      name:"PBKDF2",hash:"SHA-256",
      salt:new TextEncoder().encode("VHF-GPS-MASTER|"+PROTOCOL_ID),
      iterations:PBKDF2_ITERATIONS
    },base,256);
  const key=await crypto.subtle.importKey("raw",bits,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  masterKeyCache={secret:s,key};
  return key;
}

async function fingerprintIndex1024(key,label){
  const h=await hmacBytes(key,label);
  return (((h[0]<<8)|h[1]) & 0xFFFF) % 1024;
}

async function fingerprintNatoIndex(key,compatDigest){
  for(let counter=0;counter<16;counter++){
    const h=await hmacBytes(key,`${PROTOCOL_ID}|${SESSION_FINGERPRINT_VERSION}|COMPAT=${compatDigest}|NATO|${counter}`);
    const v=((h[0]<<8)|h[1])&0xFFFF;
    const limit=Math.floor(65536/26)*26;
    if(v<limit)return v%26;
  }
  throw new Error("Impossible de calculer l'empreinte OTAN.");
}

async function sessionFingerprint(secret){
  const [key,compatDigest]=await Promise.all([
    deriveMasterKey(secret),
    protocolCompatDigestHex()
  ]);
  const base=`${PROTOCOL_ID}|${SESSION_FINGERPRINT_VERSION}|COMPAT=${compatDigest}`;
  const i1=await fingerprintIndex1024(key,`${base}|WORD|1`);
  const i2=await fingerprintIndex1024(key,`${base}|WORD|2`);
  const i3=await fingerprintIndex1024(key,`${base}|WORD|3`);
  const ni=await fingerprintNatoIndex(key,compatDigest);
  return {
    words:[FINGERPRINT_WORDS[i1],FINGERPRINT_WORDS[i2],FINGERPRINT_WORDS[i3]],
    nato:NATO_WORDS[ni],
    compat:compatDigest
  };
}

async function showSessionFingerprint(secret){
  const revision=activeSessionRevision;
  const fp=await sessionFingerprint(secret);
  if(activeSecret()!==secret || activeSessionRevision!==revision)return null;
  $("fingerprintWords").textContent=`${fp.words[0]} · ${fp.words[1]} · ${fp.words[2]} | ${fp.nato}`;
  $("fingerprintBlock").classList.remove("hidden");
  $("sessionCompactStatus").textContent=`Session active · ${sessionAgeText()}`;
  return fp;
}

function hideSessionFingerprint(){
  $("fingerprintBlock").classList.add("hidden");
  $("fingerprintWords").textContent="";
  $("sessionCompactStatus").textContent="Aucune session active — ouvre les réglages pour en créer ou en coller une.";
}

async function responseWordFor(key,label,excluded=[]){
  const h=await hmacBytes(key,label);
  const ban=new Set(excluded);
  for(let i=0;i<h.length;i++){
    const w=ACK_WORDS[h[i]%ACK_WORDS.length];
    if(!ban.has(w))return w;
  }
  return ACK_WORDS.find(w=>!ban.has(w))||ACK_WORDS[0];
}
async function nackTable(secret,phrase=null){
  const key=await deriveMasterKey(secret),used=[];
  const out={};
  out.repeat=await responseWordFor(key,"NACK|REPEAT",used);used.push(out.repeat);

  // Ces quatre NACK sont liés à la session, pas à la phrase :
  // ils doivent rester calculables même si le mot reçu est hors catalogue.
  for(let i=1;i<=4;i++){
    out["word"+i]=await responseWordFor(key,"NACK|WORD"+i,used);
    used.push(out["word"+i]);
  }

  const words=phrase?.words?.map(norm)||[];
  const wordContext=words.length===4?words.join("|"):"NO-PHRASE";

  // ET/OU exclut volontairement le connecteur :
  // les deux côtés calculent le même NACK si seul ET/OU a été mal entendu.
  out.etou=await responseWordFor(key,"NACK|ETOU|"+wordContext,used);used.push(out.etou);

  // ZONE exclut volontairement la zone mais conserve le connecteur :
  // même NACK si seule la zone est mauvaise.
  out.zone=await responseWordFor(key,"NACK|ZONE|"+wordContext+"|"+(phrase?.connector||"?"),used);used.push(out.zone);
  return out;
}

function canonicalCoord(v){
  const n=Number(v);
  if(!Number.isFinite(n))return NaN;
  return Number(n.toFixed(5));
}
function canonicalAnchorCoord(v){
  const n=Number(v);
  if(!Number.isFinite(n))return NaN;
  return Number(n.toFixed(2));
}
function isQuarterDegree(v){
  const n=Number(v);
  return Number.isFinite(n) && Math.abs(n*4-Math.round(n*4))<1e-9;
}
function quarterDegreeHint(v){
  const n=Number(v);
  if(!Number.isFinite(n))return "";
  const scaled=n*4;
  const low=Math.floor(scaled)/4;
  const high=Math.ceil(scaled)/4;
  if(Math.abs(low-high)<1e-12)return low.toFixed(2);
  return `${low.toFixed(2)} ou ${high.toFixed(2)}`;
}
function assertValidPublicAnchor(lat,lon){
  const nLat=Number(lat),nLon=Number(lon);
  if(!Number.isFinite(nLat)||nLat<-89||nLat>89||!Number.isFinite(nLon)||nLon<-180||nLon>180){
    throw new Error("Ancre invalide : coordonnées hors limites.");
  }

  const errors=[];
  if(!isQuarterDegree(nLat))errors.push(`latitude ${nLat} (attendu : ${quarterDegreeHint(nLat)})`);
  if(!isQuarterDegree(nLon))errors.push(`longitude ${nLon} (attendu : ${quarterDegreeHint(nLon)})`);

  if(errors.length){
    throw new Error(
      `Ancre invalide : ${errors.join(" ; ")}. `+
      `Les ancres doivent être sur la grille de 0,25°. Vérifie les chiffres entendus.`
    );
  }
}
function zoneCenterKey(z){return `${canonicalCoord(z.lat).toFixed(5)}|${canonicalCoord(z.lon).toFixed(5)}`;}
function sameZoneCenter(a,b){return zoneCenterKey(a)===zoneCenterKey(b);}
function isAnchoredZone(z){return Number.isFinite(Number(z.anchorLat))&&Number.isFinite(Number(z.anchorLon));}
function isOutingEphemeral(z){
  return !!z?.ephemeral && !!z.outingId && z.outingId===appStorage.getItem(OUTING_ID_KEY);
}
function isRecentEphemeral(z){
  return !z.ephemeral || isOutingEphemeral(z) ||
    (Number(z.createdAt)>0 && Date.now()-Number(z.createdAt)<=EPHEMERAL_TTL_MS);
}
function restoreOutingEphemeralLabel(z){
  const outingId=appStorage.getItem(OUTING_ID_KEY);
  if(!z.ephemeral || !outingId || !appStorage.getItem(SESSION_SECRET_KEY))return;
  const installedAt=Number(appStorage.getItem(OUTING_INSTALLED_AT_KEY)||0);
  // Migration des sorties préparées par une version antérieure : la zone créée
  // localement n'avait pas encore de marqueur, contrairement à la zone importée.
  const legacyCreator=z.id===appStorage.getItem("vhfGpsActiveZoneV1") &&
    installedAt>0 && Math.abs(Number(z.createdAt)-installedAt)<60000;
  if(z.outingId===outingId || (!z.outingId && (z.importedOuting || legacyCreator))){
    z.outingId=outingId;
    z.name=OUTING_EPHEMERAL_NAME;
    delete z.importedOuting;
  }
}

function loadZones(){
  let custom=[];
  try{
    const rawV4=appStorage.getItem("vhfGpsZonesV4Custom");
    if(rawV4){
      const z=JSON.parse(rawV4);
      if(Array.isArray(z))custom=z;
    }else{
      // Migration prudente : on récupère seulement les anciennes zones fixes.
      const old=JSON.parse(appStorage.getItem("vhfGpsZonesV3Custom")||"[]");
      if(Array.isArray(old))custom=old.filter(x=>!x.ephemeral&&!x.received);
    }
  }catch{}

  const now=Date.now(),dedup=new Map();
  for(const x of custom){
    if(!x||x.builtin)continue;
    // Le centre secret d'une zone éphémère dépend du protocole : une ancienne
    // zone ne doit jamais être réutilisée après un changement de PROTO.
    const z={...x};
    restoreOutingEphemeralLabel(z);
    if(z.ephemeral && (z.protocolId!==PROTOCOL_ID || !isAnchoredZone(z) || !isRecentEphemeral(z)))continue;
    z.lat=canonicalCoord(z.lat);z.lon=canonicalCoord(z.lon);
    if(isAnchoredZone(z)){
      z.anchorLat=canonicalAnchorCoord(z.anchorLat);
      z.anchorLon=canonicalAnchorCoord(z.anchorLon);
      if(!isQuarterDegree(z.anchorLat)||!isQuarterDegree(z.anchorLon))continue;
    }
    if(!Number.isFinite(z.lat)||!Number.isFinite(z.lon))continue;
    const key=isAnchoredZone(z)?`A|${z.anchorLat.toFixed(2)}|${z.anchorLon.toFixed(2)}`:`C|${zoneCenterKey(z)}`;
    if(!dedup.has(key))dedup.set(key,z);
  }
  return [...BUILTIN_ZONES.map(z=>({...z,lat:canonicalCoord(z.lat),lon:canonicalCoord(z.lon)})),...dedup.values()];
}
let zones=loadZones();
let ephemeralDeletionRevision=0;

function saveZones(){
  appStorage.setItem("vhfGpsZonesV4Custom",JSON.stringify(zones.filter(z=>!z.builtin&&isRecentEphemeral(z))));
}
function purgeEphemeralZones(){
  const before=zones.length;
  zones=zones.filter(z=>z.builtin||!z.ephemeral);
  if(zones.length!==before){
    saveZones();
    const preferred=zones.some(z=>z.id===activeZoneId)
      ? activeZoneId
      : (zones.find(z=>z.builtin)?.id || zones[0]?.id || "");
    setActiveZone(preferred,{refresh:false});
    populateZones(preferred);
  }
}

const sendZone=$("sendZone"),recvZone=$("recvZone");
const ACTIVE_ZONE_STORAGE_KEY="vhfGpsActiveZoneV1";

let activeZoneId="";
let activeZoneRevision=0;
const storedActiveZoneId=appStorage.getItem(ACTIVE_ZONE_STORAGE_KEY)||"";
if(zones.some(z=>z.id===storedActiveZoneId))activeZoneId=storedActiveZoneId;
else if(zones.length)activeZoneId=zones[0].id;

function activeZone(){
  return zones.find(z=>z.id===activeZoneId)||zones[0];
}

function selectHasZone(sel,id){
  return [...sel.options].some(o=>o.value===id);
}

function syncZoneSelects(){
  if(selectHasZone(sendZone,activeZoneId))sendZone.value=activeZoneId;
  if(selectHasZone(recvZone,activeZoneId))recvZone.value=activeZoneId;
}

function setActiveZone(id,{invalidate=true,persist=true,refresh=true}={}){
  const before=zones.length;
  zones=zones.filter(z=>z.builtin||isRecentEphemeral(z));
  if(zones.length!==before)saveZones();
  const target=zones.find(z=>z.id===id) || zones[0];
  if(!target)return null;

  const changed=activeZoneId!==target.id;
  activeZoneId=target.id;
  if(changed)activeZoneRevision++;

  syncZoneSelects();

  if(persist)appStorage.setItem(ACTIVE_ZONE_STORAGE_KEY,activeZoneId);

  if(changed){
    // Toute sélection d'une nouvelle zone impose une nouvelle comparaison
    // humaine de l'alias, même si cette zone avait déjà été confirmée
    // plus tôt pendant la session.
    hideOutingSuccessDialog();
    confirmedZoneIds.delete(target.id);
    manualConfirmedZoneIds.delete(target.id);
    outingAutoConfirmedZoneId=null;
    saveZoneConfirmations();
    clearOutingShare();

    if(invalidate){
      invalidateEncodedResult();
      invalidateDecodedResult();
    }
  }

  if(refresh)populateZones();
  if(typeof refreshPositionHemisphereDefaults==="function")refreshPositionHemisphereDefaults();
  if(typeof refreshOutingActions==="function")refreshOutingActions();
  return target;
}

let pendingZoneSwitch=null;
async function confirmManualZoneChange(name,{creation=false,detail=""}={}){
  if(pendingZoneSwitch)return false;
  const revision=activeSessionRevision,previousZoneId=activeZoneId;
  $("zoneSwitchTitle").textContent=creation?"Créer et activer cette zone ?":"Changer de zone ?";
  $("zoneSwitchFrom").textContent=activeZone()?.name||"—";
  $("zoneSwitchTo").textContent=name;
  $("zoneSwitchDetail").textContent=detail;
  $("zoneSwitchDetail").classList.toggle("hidden",!detail);
  $("confirmZoneSwitch").textContent=creation?"CRÉER ET ACTIVER LA ZONE":"ACTIVER CETTE ZONE";
  const accepted=await new Promise(resolve=>{
    pendingZoneSwitch={resolve};
    $("zoneSwitchDialog").showModal();
  });
  if(!accepted)return false;
  if(activeSessionRevision!==revision||activeZoneId!==previousZoneId){
    throw new Error("La session ou la zone active a changé pendant la confirmation. Recommence.");
  }
  return true;
}
$("cancelZoneSwitch").onclick=()=>$("zoneSwitchDialog").close();
$("confirmZoneSwitch").onclick=()=>{
  const pending=pendingZoneSwitch;
  if(!pending)return;
  pendingZoneSwitch=null;
  $("zoneSwitchDialog").close();
  pending.resolve(true);
};
$("zoneSwitchDialog").addEventListener("close",()=>{
  const pending=pendingZoneSwitch;
  pendingZoneSwitch=null;
  if(pending)pending.resolve(false);
});
function clearSenderPositionInputs(){
  // Les deux modes se synchronisent : vider aussi le mode masqué évite
  // qu'une ancienne position réapparaisse en changeant de format.
  senderGpsRevision++;
  for(const id of ["latDeg","latMin","lonDeg","lonMin","lat","lon"])$(id).value="";
  refreshPositionHemisphereDefaults();
  updatePositionCanonicalPreview(NaN,NaN);
  handlePositionChanged();
}
async function switchToExistingZone(id,{clearPosition=false}={}){
  const target=zones.find(z=>z.id===id);
  if(!target)throw new Error("Cette zone n’est plus disponible.");
  if(target.id===activeZoneId)return false;
  if(!await confirmManualZoneChange(target.name))return false;
  if(!zones.includes(target))throw new Error("Cette zone n’est plus disponible. Recommence.");
  setActiveZone(target.id,{invalidate:true,persist:true,refresh:true});
  if(clearPosition)clearSenderPositionInputs();
  refreshDecodeState();
  return true;
}

const ZONE_CONFIRM_STORAGE_KEY="vhfGpsZoneConfirmV2";

const confirmedZoneIds=new Set();
const manualConfirmedZoneIds=new Set();
let outingAutoConfirmedZoneId=null;
let ephemeralWorkflowRevision=0;
let receivedZoneNoticeContext=null;
let zoneDeletionNotice=null;

function confirmationSessionKey(){
  const secret=activeSecret();
  if(!validateSessionSecret(secret).ok)return "";
  return `${PROTOCOL_ID}|${secret}`;
}

function loadZoneConfirmations(){
  confirmedZoneIds.clear();
  manualConfirmedZoneIds.clear();
  outingAutoConfirmedZoneId=null;

  const sessionKey=confirmationSessionKey();
  if(!sessionKey)return;

  try{
    const raw=appStorage.getItem(ZONE_CONFIRM_STORAGE_KEY);
    if(!raw)return;

    const data=JSON.parse(raw);
    if(!data || data.sessionKey!==sessionKey || !Array.isArray(data.zoneIds))return;

    for(const id of data.zoneIds){
      if(zones.some(z=>z.id===id)){
        confirmedZoneIds.add(id);
      }
    }
    for(const id of Array.isArray(data.manualZoneIds)?data.manualZoneIds:[]){
      if(confirmedZoneIds.has(id))manualConfirmedZoneIds.add(id);
    }
    if(data.outingId===appStorage.getItem(OUTING_ID_KEY)&&confirmedZoneIds.has(data.outingAutoConfirmedZoneId)){
      outingAutoConfirmedZoneId=data.outingAutoConfirmedZoneId;
    }
  }catch(_){
    appStorage.removeItem(ZONE_CONFIRM_STORAGE_KEY);
  }
}

function saveZoneConfirmations(){
  const sessionKey=confirmationSessionKey();

  if(!sessionKey){
    appStorage.removeItem(ZONE_CONFIRM_STORAGE_KEY);
    return;
  }

  appStorage.setItem(
    ZONE_CONFIRM_STORAGE_KEY,
    JSON.stringify({sessionKey,zoneIds:[...confirmedZoneIds],manualZoneIds:[...manualConfirmedZoneIds],
      outingId:outingAutoConfirmedZoneId?appStorage.getItem(OUTING_ID_KEY):null,
      outingAutoConfirmedZoneId})
  );
}

function clearZoneConfirmations(){
  confirmedZoneIds.clear();
  manualConfirmedZoneIds.clear();
  outingAutoConfirmedZoneId=null;
  appStorage.removeItem(ZONE_CONFIRM_STORAGE_KEY);
}

function isZoneConfirmed(z){
  return !!z && confirmedZoneIds.has(z.id);
}

let encodeRevision=0;
function invalidateEncodedResult(){
  encodeRevision++;
  hideStatus("encodeStatus");
  $("encodedBlock").classList.add("hidden");
  $("senderAckBlock").classList.add("hidden");
  debugDetailsReady=false;
  refreshDebugDetails();

  const encodedWords=$("encodedWords");
  const senderAck=$("senderExpectedAckWord");
  const senderFinal=$("senderFinalConfirmWord");
  const senderReturns=$("senderReturnTable");
  const activeTime=$("activeTransmissionTime");
  const debugSummary=$("debugSummary");
  const debugGrid=$("debugGrid");

  if(encodedWords)encodedWords.textContent="";
  if(senderAck)senderAck.textContent="—";
  if(senderFinal)senderFinal.textContent="—";
  if(senderReturns)senderReturns.innerHTML="";
  if(activeTime)activeTime.textContent="";
  if(debugSummary)debugSummary.textContent="";
  if(debugGrid)debugGrid.innerHTML="";
}

function refreshEncodeState(){
  const btn=$("encodeBtn");
  if(!btn)return;

  const z=selectedZone(sendZone);
  const p=readActivePosition();
  const protocolOk=protocolRuntimeState===PROTOCOL_STATE.OK;
  const secretOk=validateSessionSecret(activeSecret()).ok;
  const inside=!!z && p.ok && zoneCheck(p.lat,p.lon,z).inside;
  const zoneOk=isZoneConfirmed(z);

  const ready=protocolOk && secretOk && inside && zoneOk;
  btn.disabled=!ready;
  btn.classList.toggle("hidden",!(protocolOk && secretOk && inside));
  btn.classList.toggle("encode-ready",ready);
  $("encodeBtnLabel").textContent=!protocolOk
    ?(protocolRuntimeState===PROTOCOL_STATE.CHECKING?"VÉRIFICATION DU PROTOCOLE…":"PROTOCOLE INDISPONIBLE")
    :!secretOk?"ACTIVE D’ABORD UNE SESSION"
    :!p.ok?"COMPLÈTE LA POSITION"
    :!inside?"POSITION HORS ZONE"
    :!zoneOk?"CONFIRME L’ALIAS ZONE POUR GÉNÉRER LE CODE"
    :"✓ 🔒 GÉNÉRER LE CODE";
  $("encodePositionMemo").classList.toggle("hidden",!ready);
  $("encodePositionLat").textContent=ready?formatDegMin(p.lat,true):"";
  $("encodePositionLon").textContent=ready?formatDegMin(p.lon,false):"";

  const best=z && p.ok && !inside?compatibleZones(p.lat,p.lon,z.id)[0]:null;
  const switchBtn=$("useCompatibleZoneBtn");
  switchBtn.disabled=!best || !protocolOk || !secretOk;
  const ephemeralBtn=$("ephemeralZoneBtn");
  const offerEphemeral=protocolOk && secretOk && p.ok && shouldOfferEphemeralZone(p.lat,p.lon);
  ephemeralBtn.classList.toggle("hidden",!offerEphemeral);
  ephemeralBtn.disabled=!offerEphemeral;
}

function refreshZoneConfirmationUi(){
  const z=activeZone();
  const validSecret=validateSessionSecret(activeSecret()).ok;
  const confirmed=!!z && validSecret && isZoneConfirmed(z);
  const outingConfirmed=confirmed&&outingAutoConfirmedZoneId===z.id&&outingMatchesOriginalZone(z);
  const radioConfirmed=confirmed&&manualConfirmedZoneIds.has(z.id);

  if(receivedZoneNoticeContext && (
    receivedZoneNoticeContext.zoneId!==z?.id ||
    receivedZoneNoticeContext.secret!==activeSecret() || confirmed
  )){
    hideStatus("receivedZoneNotice");
    receivedZoneNoticeContext=null;
  }

  for(const side of ["send","recv"]){
    const state=$(side+"ZoneConfirmState");
    const btn=$(side+"ZoneConfirmBtn");
    const block=$(side+"ZoneConfirmBlock");
    if(!state||!btn||!block)continue;

    // Côté émission, la zone éphémère conserve son workflow spécialisé.
    block.classList.toggle("hidden",side==="send" && !!z && isAnchoredZone(z));

    state.className="protocol-state-pill "+(confirmed?"protocol-state-confirmed":"protocol-state-provisional");
    state.textContent=confirmed
      ?outingConfirmed?"● ZONE VALIDÉE AVEC LA SORTIE":radioConfirmed?"● ALIAS ZONE COMPARÉ À LA RADIO":"● ALIAS ZONE CONFIRMÉ"
      :"● ALIAS ZONE À CONFIRMER";

    btn.classList.remove("zone-confirm-pending","zone-confirm-done","zone-confirm-unavailable");

    if(confirmed){
      btn.classList.add("zone-confirm-done");
      btn.disabled=true;
      btn.textContent=outingConfirmed
        ?"✓ ZONE VALIDÉE AVEC LA SORTIE — PRÊTE"
        :radioConfirmed?"✓ ALIAS ZONE COMPARÉ À LA RADIO — PRÊTE":"✓ ALIAS ZONE CONFIRMÉ — PRÊTE";
    }else if(validSecret && z){
      btn.classList.add("zone-confirm-pending");
      btn.disabled=false;
      btn.textContent="⚠ OBLIGATOIRE — J’AI COMPARÉ L’ALIAS DE CETTE ZONE À LA RADIO";
    }else{
      btn.classList.add("zone-confirm-unavailable");
      btn.disabled=true;
      btn.textContent="ACTIVE D’ABORD UNE SESSION";
    }
  }
}

async function confirmActiveZoneAlias(){
  assertProtocolReady();
  const z=activeZone();
  if(!z)throw new Error("Aucune zone active.");
  const secret=activeSecret();
  if(!validateSessionSecret(secret).ok)throw new Error("Valide d’abord le secret de session.");

  // Préparer les données sans rendre la zone utilisable avant l’enregistrement.
  const nextConfirmed=new Set(confirmedZoneIds),nextManual=new Set(manualConfirmedZoneIds);
  nextConfirmed.add(z.id);nextManual.add(z.id);
  const nextAuto=outingAutoConfirmedZoneId===z.id?null:outingAutoConfirmedZoneId;
  await window.VHFIntegration.checkpoint(ZONE_CONFIRM_STORAGE_KEY,JSON.stringify({
    sessionKey:confirmationSessionKey(),zoneIds:[...nextConfirmed],manualZoneIds:[...nextManual],
    outingId:nextAuto?appStorage.getItem(OUTING_ID_KEY):null,outingAutoConfirmedZoneId:nextAuto
  }));
  if(activeSecret()!==secret||activeZone()?.id!==z.id)throw Error("La session ou la zone a changé pendant l’enregistrement.");
  confirmedZoneIds.add(z.id);manualConfirmedZoneIds.add(z.id);outingAutoConfirmedZoneId=nextAuto;
  refreshZoneConfirmationUi();
  refreshOutingActions();
  await refreshEphemeralWorkflow();
  refreshEncodeState();
  refreshDecodeState();
}

async function refreshEphemeralWorkflow(){
  refreshEncodeState();
  const revision=++ephemeralWorkflowRevision;
  const z=selectedZone(sendZone);
  const block=$("ephemeralBlock");

  if(!isAnchoredZone(z)){
    block.classList.add("hidden");
    refreshEncodeState();
    return;
  }

  block.classList.remove("hidden");

  const radio=formatAnchorForRadio(z);
  $("ephemeralCenter").textContent=radio.signed;

  const lat=parseNum($("lat").value),lon=parseNum($("lon").value);
  if(Number.isFinite(lat)&&Number.isFinite(lon)){
    const c=zoneCheck(lat,lon,z);
    $("ephemeralMetrics").innerHTML=c.inside
      ?`<strong>Contrôle :</strong> marge au bord du carré secret le plus proche ${c.nearest.toFixed(1)} km · centre virtuel non affiché.`
      :`<strong>Attention :</strong> la position actuelle est hors de cette zone éphémère.`;
  }else{
    $("ephemeralMetrics").innerHTML=`<strong>Zone active :</strong> centre virtuel non affiché.`;
  }

  const confirmed=confirmedZoneIds.has(z.id);
  const outingConfirmed=confirmed&&outingAutoConfirmedZoneId===z.id&&outingMatchesOriginalZone(z);
  const radioConfirmed=confirmed&&manualConfirmedZoneIds.has(z.id);
  $("ephemeralReadyStep").classList.toggle("hidden",!confirmed);
  $("ephemeralAliasStep").classList.toggle("ephemeral-confirmed",confirmed);

  const confirmBtn=$("ephemeralAliasConfirmBtn");
  confirmBtn.classList.remove("ephemeral-confirm-pending","ephemeral-confirm-done","zone-confirm-pending","zone-confirm-done");
  confirmBtn.disabled=true;
  confirmBtn.textContent=confirmed
    ?outingConfirmed?"✓ ZONE VALIDÉE AVEC LA SORTIE — PRÊTE":radioConfirmed?"✓ ALIAS ZONE COMPARÉ À LA RADIO — PRÊTE":"✓ ALIAS ZONE CONFIRMÉ — PRÊTE"
    :"⚠ OBLIGATOIRE — J’AI COMPARÉ L’ALIAS DE CETTE ZONE À LA RADIO";
  if(confirmed){
    confirmBtn.classList.add("ephemeral-confirm-done");
  }else{
    confirmBtn.classList.add("ephemeral-confirm-pending");
  }

  hideStatus("ephemeralConfirmStatus");

  const secret=activeSecret();
  if(!validateSessionSecret(secret).ok){
    $("ephemeralAlias").textContent="Secret de session requis";
    refreshEncodeState();
    return;
  }

  try{
    const alias=await zoneAlias(secret,z);
    if(revision!==ephemeralWorkflowRevision || sendZone.value!==z.id)return;
    $("ephemeralAlias").textContent=alias.text;
    confirmBtn.disabled=confirmed;
    if(!confirmed){
      confirmBtn.classList.add("ephemeral-confirm-pending");
    }
  }catch(e){
    if(revision!==ephemeralWorkflowRevision)return;
    $("ephemeralAlias").textContent="Alias indisponible";
    setStatus("ephemeralConfirmStatus",e.message||String(e),"bad");
  }

  refreshEncodeState();
}

function selectedZone(sel){return zones.find(z=>z.id===sel.value)||zones[0];}

function zoneBounds(z){
  const a=111.32,b=111.32*Math.cos(z.lat*Math.PI/180);
  return{minLat:z.lat-HALF_KM/a,maxLat:z.lat+HALF_KM/a,minLon:z.lon-HALF_KM/b,maxLon:z.lon+HALF_KM/b};
}

function zoneBoundsCompass(z){
  const b=zoneBounds(z);
  return `<div class="zone-bounds-title">Limites encodables</div>`+
    `<div class="zone-bound-grid">`+
      `<div class="zone-bound-cell north"><strong>NORD</strong><span>${formatDegMin(b.maxLat,true)}</span></div>`+
      `<div class="zone-bound-cell west"><strong>OUEST</strong><span>${formatDegMin(b.minLon,false)}</span></div>`+
      `<div class="zone-bound-cell center"><strong>CENTRE</strong><span>${formatDegMin(z.lat,true)}<br>${formatDegMin(z.lon,false)}</span></div>`+
      `<div class="zone-bound-cell east"><strong>EST</strong><span>${formatDegMin(b.maxLon,false)}</span></div>`+
      `<div class="zone-bound-cell south"><strong>SUD</strong><span>${formatDegMin(b.minLat,true)}</span></div>`+
    `</div>`;
}

function zoneSummary(z){
  const b=zoneBounds(z),name=escapeHtml(z.name);

  if(isAnchoredZone(z)){
    return `<div class="zone-ephemeral-banner">ZONE ÉPHÉMÈRE ACTIVE</div>`+
      `<strong>${name}</strong>`+
      (isOutingEphemeral(z)?`<span class="zone-outing-badge">SORTIE</span>`:``)+
      `<div class="zone-marine-center ephemeral-anchor-panel">`+
        `<span class="zone-coord-label">Ancre publique · degrés décimaux</span>`+
        `${z.anchorLat.toFixed(2)} / ${z.anchorLon.toFixed(2)}`+
      `</div>`+
      `<div class="small" style="margin-top:5px">Grille 0,25° · décimales .00 / .25 / .50 / .75</div>`+
      `<div class="ephemeral-zone-center">`+
        `<span class="zone-coord-label">Centre de la zone · Marine</span>`+
        `<strong>${formatDegMin(z.lat,true)}</strong>`+
        `<strong>${formatDegMin(z.lon,false)}</strong>`+
        `<div class="ephemeral-secret-warning">`+
          `<strong>NE PAS TRANSMETTRE À LA VHF</strong>`+
          `Centre virtuel calculé localement à partir de l’ancre publique + du secret de session.`+
        `</div>`+
      `</div>`+
      zoneBoundsCompass(z)+
      `<div style="margin-top:7px">Carré : 250 × 250 km — 125 km sur chaque axe depuis le centre — maille : 100 m</div>`+
      `<details class="zone-decimal-details">`+
        `<summary>Coordonnées décimales du centre et des limites</summary>`+
        `<div class="zone-decimal-body">`+
          `Centre : ${z.lat.toFixed(5)} / ${z.lon.toFixed(5)}<br>`+
          `Latitude : ${b.minLat.toFixed(5)} → ${b.maxLat.toFixed(5)}<br>`+
          `Longitude : ${b.minLon.toFixed(5)} → ${b.maxLon.toFixed(5)}`+
        `</div>`+
      `</details>`;
  }

  const centerMarine=`${formatDegMin(z.lat,true)} / ${formatDegMin(z.lon,false)}`;
  return (isCustomFixedZone(z)?`<div class="zone-custom-banner">ZONE PERSONNALISÉE ACTIVE</div>`:"")+
    `<strong>${name}</strong>`+
    `<div class="zone-marine-center">`+
      `<span class="zone-coord-label">Centre · Marine</span>`+
      `${centerMarine}`+
    `</div>`+
    zoneBoundsCompass(z)+
    `<div style="margin-top:7px">Carré : 250 × 250 km — 125 km sur chaque axe depuis le centre — maille : 100 m</div>`+
    `<details class="zone-decimal-details">`+
      `<summary>Coordonnées décimales</summary>`+
      `<div class="zone-decimal-body">`+
        `Centre : ${z.lat.toFixed(5)} / ${z.lon.toFixed(5)}<br>`+
        `Latitude : ${b.minLat.toFixed(5)} → ${b.maxLat.toFixed(5)}<br>`+
        `Longitude : ${b.minLon.toFixed(5)} → ${b.maxLon.toFixed(5)}`+
      `</div>`+
    `</details>`;
}

function populateManageZones(preferredId=""){
  const sel=$("manageZoneSelect"),custom=zones.filter(z=>!z.builtin).sort(compareZoneNames);
  const ephemeralCount=zones.filter(z=>z.ephemeral&&!isOutingEphemeral(z)).length;
  const protectedCount=zones.filter(isOutingEphemeral).length;
  const deleteEphemeralBtn=$("deleteEphemeralZonesBtn");
  deleteEphemeralBtn.disabled=!ephemeralCount;
  deleteEphemeralBtn.textContent=ephemeralCount
    ?`SUPPRIMER ${ephemeralCount===1?"LA ZONE ÉPHÉMÈRE":`LES ${ephemeralCount} ZONES ÉPHÉMÈRES`}`
    :protectedCount?"ZONE ÉPHÉMÈRE DE SORTIE CONSERVÉE":"AUCUNE ZONE ÉPHÉMÈRE À SUPPRIMER";
  const old=preferredId||sel.value;
  sel.innerHTML="";
  if(!custom.length){
    const o=document.createElement("option");o.value="";o.textContent="Aucune zone personnalisée";sel.appendChild(o);
    updateManageZoneDeletionButton();return;
  }
  for(const z of custom){const o=document.createElement("option");o.value=z.id;o.textContent=zoneDisplayName(z);sel.appendChild(o);}
  sel.value=custom.some(z=>z.id===old)?old:custom[0].id;
  updateManageZoneDeletionButton();
}
function updateManageZoneDeletionButton(){
  const z=zones.find(x=>x.id===$("manageZoneSelect").value);
  const protectedZone=isOutingEphemeral(z),button=$("deleteZoneBtn");
  button.disabled=!z||protectedZone;
  button.textContent=protectedZone?"ZONE ÉPHÉMÈRE DE SORTIE CONSERVÉE":"SUPPRIMER CETTE ZONE";
}

function isCustomFixedZone(z){return !!z && !z.builtin && !z.ephemeral && !isAnchoredZone(z);}
function zoneDisplayName(z){return z.builtin?z.name:`** ${z.name} **`;}
function compareZoneNames(a,b){return a.name.localeCompare(b.name,"fr",{sensitivity:"base"});}

function populateZoneSelect(sel,entries,selectedId){
  sel.innerHTML="";
  for(const e of entries){
    const o=document.createElement("option");
    o.value=e.z.id;
    o.textContent=e.label;
    sel.appendChild(o);
  }
  if(entries.some(e=>e.z.id===selectedId))sel.value=selectedId;
  else if(entries.length)sel.value=entries[0].z.id;
}

function populateZones(selid){
  // Affichage uniquement : seul setActiveZone change la zone et sa confirmation.
  const plainEntries=[...zones]
    .sort(compareZoneNames)
    .map(z=>({z,label:zoneDisplayName(z)}));

  populateZoneSelect(sendZone,plainEntries,activeZoneId);
  populateZoneSelect(recvZone,plainEntries,activeZoneId);
  syncZoneSelects();

  populateManageZones(selid);
  return updateZoneSummaries();
}

let zoneAliasRefreshRevision=0;

async function refreshZoneAliases(){
  const revision=++zoneAliasRefreshRevision;
  const secret=activeSecret(),valid=validateSessionSecret(secret).ok;

  if(!valid){
    const entries=[...zones]
      .sort(compareZoneNames)
      .map(z=>({z,label:zoneDisplayName(z)}));
    populateZoneSelect(sendZone,entries,activeZoneId);
    populateZoneSelect(recvZone,entries,activeZoneId);
    syncZoneSelects();

    for(const outId of ["sendZoneAlias","recvZoneAlias"]){
      const out=$(outId);
      out.className="zone-alias-inline radio-block hidden";
      out.textContent="";
    }
    const reminder=$("encodedZoneAliasReminder");
    if(reminder)reminder.textContent="—";
    return;
  }

  const requestedSecret=secret;
  const rows=await Promise.all(zones.map(async z=>({z,alias:await zoneAlias(secret,z)})));
  if(revision!==zoneAliasRefreshRevision || activeSecret()!==requestedSecret)return;

  const counts=new Map();
  for(const r of rows)counts.set(r.alias.text,(counts.get(r.alias.text)||0)+1);

  // ÉMETTRE : l'utilisateur connaît d'abord le nom du lieu.
  const sendRows=[...rows].sort((a,b)=>{
    const byName=compareZoneNames(a.z,b.z);
    return byName || a.alias.text.localeCompare(b.alias.text,"fr",{sensitivity:"base"});
  });
  const sendEntries=sendRows.map(r=>({
    z:r.z,
    alias:r.alias,
    label:`${zoneDisplayName(r.z)} — ${r.alias.text}${counts.get(r.alias.text)>1?" ⚠":""}`
  }));

  // RECEVOIR : l'utilisateur cherche l'alias entendu à la VHF.
  const recvRows=[...rows].sort((a,b)=>{
    const byAlias=a.alias.text.localeCompare(b.alias.text,"fr",{sensitivity:"base"});
    return byAlias || compareZoneNames(a.z,b.z);
  });
  const recvEntries=recvRows.map(r=>({
    z:r.z,
    alias:r.alias,
    label:`${r.alias.text} — ${zoneDisplayName(r.z)}${counts.get(r.alias.text)>1?" ⚠":""}`
  }));

  populateZoneSelect(sendZone,sendEntries,activeZoneId);
  populateZoneSelect(recvZone,recvEntries,activeZoneId);
  syncZoneSelects();

  for(const [sel,outId] of [[sendZone,"sendZoneAlias"],[recvZone,"recvZoneAlias"]]){
    const out=$(outId),row=rows.find(r=>r.z.id===sel.value);
    if(!row){
      out.className="zone-alias-inline radio-block hidden";
      out.textContent="";
      continue;
    }

    const duplicate=counts.get(row.alias.text)>1;
    out.textContent=`${row.alias.text}${duplicate?" ⚠":""}`;
    out.title=duplicate
      ?"Attention : cet alias est partagé par plusieurs zones."
      :"Alias de la zone active à annoncer ou confirmer à la VHF.";
    out.className="zone-alias-inline radio-block";
  }

  const reminder=$("encodedZoneAliasReminder");
  const activeRow=rows.find(r=>r.z.id===activeZoneId);
  if(reminder){
    reminder.textContent=activeRow
      ?`${activeRow.alias.text}${counts.get(activeRow.alias.text)>1?" ⚠":""}`
      :"—";
  }
}

function updateZoneSummaries(){
  clearZoneDeletionNotice();
  syncZoneSelects();
  const z=activeZone();
  for(const side of ["send","recv"]){
    $(side+"DeleteZoneBtn").classList.toggle("hidden",!z || !!z.builtin || isOutingEphemeral(z));
    hideStatus(side+"ZoneActionStatus");
  }
  if(!z)return;

  const ephemeral=isAnchoredZone(z),custom=isCustomFixedZone(z);
  for(const id of ["sendZoneCard","recvZoneCard"]){
    $(id).dataset.zoneType=ephemeral?"ephemeral":custom?"custom":"builtin";
  }
  for(const id of ["sendZoneSummary","recvZoneSummary"]){
    const el=$(id);
    el.innerHTML=zoneSummary(z);
    el.classList.toggle("ephemeral-active",ephemeral);
    el.classList.toggle("custom-active",custom);
  }
  sendZone.classList.toggle("ephemeral-zone-active",ephemeral);
  recvZone.classList.toggle("ephemeral-zone-active",ephemeral);
  sendZone.classList.toggle("custom-zone-active",custom);
  recvZone.classList.toggle("custom-zone-active",custom);

  checkDrift();
  // Ces rafraîchissements se chevauchent ; leur ordre de fin n'est pas garanti.
  // Les listes sendZone/recvZone doivent rester alignées sur activeZoneId :
  // toute sélection réelle passe par setActiveZone, jamais par un rafraîchissement.
  // Avant d'ajouter une mutation après un await, revérifier son contexte
  // (session, zone, révision) et son interaction avec l'autre routine.
  // Promise.all attend les deux appels, mais ne verrouille pas l'état partagé.
  const aliasesReady=refreshZoneAliases();
  const workflowReady=refreshEphemeralWorkflow();
  refreshZoneConfirmationUi();
  refreshEncodeState();
  return Promise.all([aliasesReady,workflowReady]);
}

function setStatus(id,msg,type){const e=$(id);e.textContent=msg;e.className="status "+type;}
function setDriftStatus(msg,type){
  $("driftStatusText").textContent=msg;
  $("driftStatus").className="status "+type;
  $("useCompatibleZoneBtn").classList.add("hidden");
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  })[c]);
}
function hideStatus(id){$(id).className="status hidden";}
function hideOutingSuccessDialog(){
  if(outingSuccessTimer!==null)clearTimeout(outingSuccessTimer);
  outingSuccessTimer=null;
  const dialog=$("outingSuccessDialog");
  if(dialog.open)dialog.close();
}
function showOutingSuccessDialog(message,durationMs=5000){
  hideOutingSuccessDialog();
  $("outingSuccessMessage").textContent=message;
  const dialog=$("outingSuccessDialog");
  dialog.showModal();
  outingSuccessTimer=setTimeout(()=>{
    outingSuccessTimer=null;
    if(dialog.open)dialog.close();
  },durationMs);
}
$("closeOutingSuccess").onclick=hideOutingSuccessDialog;
$("outingSuccessDialog").addEventListener("close",()=>{
  if(!$("outingSuccessDialog").open&&outingSuccessTimer!==null){
    clearTimeout(outingSuccessTimer);
    outingSuccessTimer=null;
  }
});

let receiverReminderRevision=0;

function hideReceiverCheckReminder(){
  receiverReminderRevision++;
  const box=$("receiverCheckReminder");
  if(box)box.classList.add("hidden");
}

async function showReceiverCheckReminder(){
  const box=$("receiverCheckReminder");
  if(!box)return;

  const revision=++receiverReminderRevision;
  const secret=activeSecret();
  const z=activeZone();

  let sessionText="SESSION INACTIVE / INVALIDE";
  let aliasText="—";

  if(validateSessionSecret(secret).ok){
    const existing=String($("fingerprintWords")?.textContent||"").trim();
    if(existing){
      sessionText=existing;
    }else{
      try{
        const fp=await sessionFingerprint(secret);
        if(revision!==receiverReminderRevision)return;
        sessionText=`${fp.words[0]} · ${fp.words[1]} · ${fp.words[2]} | ${fp.nato}`;
      }catch(_){}
    }

    if(z){
      try{
        const alias=await zoneAlias(secret,z);
        if(revision!==receiverReminderRevision)return;
        aliasText=alias.text;
      }catch(_){}
    }
  }

  if(revision!==receiverReminderRevision)return;

  $("receiverReminderSession").textContent=sessionText;

  if(z){
    $("receiverReminderZone").innerHTML=`${escapeHtml(zoneDisplayName(z))} <span class="receiver-secret-note">(secret)</span>`;
  }else{
    $("receiverReminderZone").textContent="AUCUNE ZONE";
  }

  $("receiverReminderAlias").textContent=aliasText;

  const confirmed=!!z && validateSessionSecret(secret).ok && isZoneConfirmed(z);
  const state=$("receiverReminderAliasState");
  state.className="receiver-check-state warn"+(confirmed?" hidden":"");
  state.textContent=confirmed
    ?""
    :"⚠ ALIAS ZONE À CONFIRMER AVANT DÉCODAGE";

  box.classList.remove("hidden");
}

function offsetKm(lat,lon,z){const a=111.32,b=111.32*Math.cos(z.lat*Math.PI/180);return{x:(lon-z.lon)*b,y:(lat-z.lat)*a};}
function latLonFromOffset(x,y,z){const a=111.32,b=111.32*Math.cos(z.lat*Math.PI/180);return{lat:z.lat+y/a,lon:z.lon+x/b};}
function zoneCheck(lat,lon,z){
  const {x,y}=offsetKm(lat,lon,z),inside=x>=-HALF_KM&&x<HALF_KM&&y>=-HALF_KM&&y<HALF_KM;
  const edgeX=HALF_KM-Math.abs(x),edgeY=HALF_KM-Math.abs(y);
  const overX=Math.max(0,Math.abs(x)-HALF_KM),overY=Math.max(0,Math.abs(y)-HALF_KM);
  return{x,y,inside,nearest:Math.min(edgeX,edgeY),overshoot:Math.hypot(overX,overY),centerDistance:Math.hypot(x,y)};
}
function publicAnchorDistanceKm(lat,lon,anchorLat,anchorLon){
  const a=111.32,b=111.32*Math.cos(anchorLat*Math.PI/180);
  return Math.hypot((lon-anchorLon)*b,(lat-anchorLat)*a);
}

const ZONE_COMFORT_MARGIN_KM=20;
function compatibleZonePriority(z){
  return z.builtin?0:isAnchoredZone(z)?1:2;
}
function compatibleZones(lat,lon,currentId){
  return zones.filter(z=>z.id!==currentId && isRecentEphemeral(z))
    .map(z=>({z,c:zoneCheck(lat,lon,z)}))
    .filter(o=>o.c.inside)
    .sort((a,b)=>compatibleZonePriority(a.z)-compatibleZonePriority(b.z) ||
      b.c.nearest-a.c.nearest || compareZoneNames(a.z,b.z) || a.z.id.localeCompare(b.z.id));
}
function shouldOfferEphemeralZone(lat,lon){
  // Une zone intégrée ou éphémère déjà disponible avec une marge confortable
  // évite une création supplémentaire. Une zone personnalisée peut rester
  // propre à ce téléphone : elle n'empêche pas de préparer une zone partageable.
  return !zones.some(z=>{
    if(!isRecentEphemeral(z)||(!z.builtin&&!isAnchoredZone(z)))return false;
    const c=zoneCheck(lat,lon,z);
    return c.inside&&c.nearest>=ZONE_COMFORT_MARGIN_KM;
  });
}

function checkDrift(){
  const p=readActivePosition();
  if(!p.ok){
    setDriftStatus(
      p.empty?"Entre une position pour vérifier sa dérive par rapport au centre virtuel.":p.error,
      p.empty?"warn":"bad"
    );
    return false;
  }

  const {lat,lon}=p;
  const z=selectedZone(sendZone),c=zoneCheck(lat,lon,z);
  if(!c.inside){
    const a=compatibleZones(lat,lon,z.id);
    setDriftStatus(`⛔ HORS ZONE — dépassement ≈ ${fmt(c.overshoot)} km. Vérifie N/S et Est/Ouest (E/W).${a.length?"":" Aucune zone connue compatible."}`,"bad");
    $("driftStatus").classList.add("drift-outside");
    if(a.length){
      const switchBtn=$("useCompatibleZoneBtn");
      switchBtn.textContent=`UTILISER ${a[0].z.name} · marge ${fmt(a[0].c.nearest)} km`;
      switchBtn.classList.remove("hidden");
    }
    return false;
  }
  const nearEdge=c.nearest<ZONE_COMFORT_MARGIN_KM;
  setDriftStatus(`✅ POSITION ENCODABLE DANS CETTE ZONE — ${nearEdge?"attention, marge faible":"marge"} au bord le plus proche : ${fmt(c.nearest)} km.`,nearEdge?"warn":"ok");
  $("driftStatus").classList.add("drift-encodable");
  $("driftStatus").classList.toggle("drift-edge",nearEdge);
  return true;
}

function zoneFingerprint(z){
  if(isAnchoredZone(z)){
    return `${PROTOCOL_ID}|${ZONE_PROTOCOL_VERSION}|EPHEMERAL|${z.anchorLat.toFixed(2)}|${z.anchorLon.toFixed(2)}|${SIDE_KM}|${CELL_KM}`;
  }
  return `${PROTOCOL_ID}|${ZONE_PROTOCOL_VERSION}|FIXED|${canonicalCoord(z.lat).toFixed(5)}|${canonicalCoord(z.lon).toFixed(5)}|${SIDE_KM}|${CELL_KM}`;
}

async function zoneAliasWordIndex(master,label,excluded=[]){
  const ban=new Set(excluded);
  for(let counter=0;counter<16;counter++){
    const h=await hmacBytes(master,`${ZONE_ALIAS_VERSION}|${label}|${counter}`),idx=(((h[0]<<8)|h[1])&0xFFFF)%1024;
    if(!ban.has(idx))return idx;
  }
  throw new Error("Impossible de calculer l'alias de zone.");
}
async function zoneAliasNatoIndex(master,label){
  for(let counter=0;counter<16;counter++){
    const h=await hmacBytes(master,`${ZONE_ALIAS_VERSION}|NATO|${label}|${counter}`),v=((h[0]<<8)|h[1])&0xFFFF,limit=Math.floor(65536/26)*26;
    if(v<limit)return v%26;
  }
  throw new Error("Impossible de calculer le code OTAN de zone.");
}
async function zoneAlias(secret,z){
  const master=await deriveMasterKey(secret),ctx=zoneFingerprint(z);
  const i1=await zoneAliasWordIndex(master,`W1|${ctx}`),i2=await zoneAliasWordIndex(master,`W2|${ctx}`,[i1]),ni=await zoneAliasNatoIndex(master,ctx);
  const words=[FINGERPRINT_WORDS[i1],FINGERPRINT_WORDS[i2]];
  return{words,nato:NATO_WORDS[ni],text:`${words[0]} · ${words[1]} | ${NATO_WORDS[ni]}`};
}


function roundGrid(v,step=EPHEMERAL_GRID_DEG){return Math.round(v/step)*step;}
function u32be(h,o){return (((h[o]<<24)>>>0)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3])>>>0;}
async function deriveSecretCenter(secret,anchorLat,anchorLon){
  assertValidPublicAnchor(anchorLat,anchorLon);
  const aLat=canonicalAnchorCoord(anchorLat),aLon=canonicalAnchorCoord(anchorLon),master=await deriveMasterKey(secret);
  const h=await hmacBytes(master,`${PROTOCOL_ID}|EPHEMERAL-CENTER-V2|${aLat.toFixed(2)}|${aLon.toFixed(2)}`);
  const ux=u32be(h,0)/4294967296,uy=u32be(h,4)/4294967296;
  const dx=(ux*2-1)*EPHEMERAL_SECRET_OFFSET_MAX_KM,dy=(uy*2-1)*EPHEMERAL_SECRET_OFFSET_MAX_KM;
  const lat=canonicalCoord(aLat+dy/111.32);
  const lon=canonicalCoord(aLon+dx/(111.32*Math.cos(lat*Math.PI/180)));
  return{lat,lon,anchorLat:aLat,anchorLon:aLon,secretOffsetX:dx,secretOffsetY:dy};
}

async function createEphemeralZoneCandidate(lat,lon,secret){
  assertProtocolReady();
  if(!Number.isFinite(lat)||lat<-89||lat>89||!Number.isFinite(lon)||lon<-180||lon>180)throw new Error("Position réelle invalide.");
  const latStepKm=111.32*EPHEMERAL_GRID_DEG;
  const lonStepKm=Math.max(1,111.32*Math.abs(Math.cos(lat*Math.PI/180))*EPHEMERAL_GRID_DEG);
  const latSteps=Math.ceil(EPHEMERAL_ANCHOR_SEARCH_KM/latStepKm),lonSteps=Math.ceil(EPHEMERAL_ANCHOR_SEARCH_KM/lonStepKm);
  const baseLat=roundGrid(lat),baseLon=roundGrid(lon),candidates=[];
  for(let iy=-latSteps;iy<=latSteps;iy++){
    const anchorLat=canonicalAnchorCoord(baseLat+iy*EPHEMERAL_GRID_DEG);if(anchorLat<=-89||anchorLat>=89)continue;
    for(let ix=-lonSteps;ix<=lonSteps;ix++){
      let anchorLon=canonicalAnchorCoord(baseLon+ix*EPHEMERAL_GRID_DEG);if(anchorLon>180)anchorLon-=360;if(anchorLon<-180)anchorLon+=360;
      const publicDistance=publicAnchorDistanceKm(lat,lon,anchorLat,anchorLon);
      if(publicDistance<EPHEMERAL_PUBLIC_ANCHOR_MIN_KM)continue;
      const center=await deriveSecretCenter(secret,anchorLat,anchorLon),z={lat:center.lat,lon:center.lon,anchorLat,anchorLon};
      const c=zoneCheck(lat,lon,z);
      if(c.inside&&c.nearest>=EPHEMERAL_EDGE_MARGIN_KM)candidates.push({z,c,publicDistance});
    }
  }
  if(!candidates.length)throw new Error("Aucune ancre publique compatible trouvée pour cette position et cette session.");
  return candidates[secureRandomIndex(candidates.length)];
}

function ephemeralLocalLabel(name="ÉPHÉMÈRE"){
  const d=new Date(),hh=String(d.getHours()).padStart(2,"0"),mm=String(d.getMinutes()).padStart(2,"0");
  return `${name} ${hh}:${mm}`;
}
function assertZoneSessionCurrent(secret,revision){
  if(activeSecret()!==secret || activeSessionRevision!==revision){
    throw new Error("La session a changé pendant le calcul de la zone. Recommence avec la session active.");
  }
}
function assertEphemeralDeletionCurrent(revision){
  if(revision!==ephemeralDeletionRevision){
    throw new Error("Les zones éphémères ont été supprimées pendant le calcul. Recommence si nécessaire.");
  }
}
async function saveOrSelectEphemeralZone(anchorLat,anchorLon,secret,name=ephemeralLocalLabel(),revision=activeSessionRevision,deletionRevision=ephemeralDeletionRevision){
  assertZoneSessionCurrent(secret,revision);
  assertEphemeralDeletionCurrent(deletionRevision);
  assertValidPublicAnchor(anchorLat,anchorLon);
  const aLat=canonicalAnchorCoord(anchorLat),aLon=canonicalAnchorCoord(anchorLon);
  const existing=zones.find(z=>!z.builtin&&isAnchoredZone(z)&&z.anchorLat===aLat&&z.anchorLon===aLon);
  if(existing)return existing;
  const center=await deriveSecretCenter(secret,aLat,aLon);
  // Aucun résultat d'une session quittée ne doit entrer dans l'état persistant.
  assertZoneSessionCurrent(secret,revision);
  assertEphemeralDeletionCurrent(deletionRevision);
  const z={id:`eph-${Date.now()}-${secureRandomIndex(1000000)}`,name,lat:center.lat,lon:center.lon,anchorLat:aLat,anchorLon:aLon,builtin:false,ephemeral:true,createdAt:Date.now(),protocolId:PROTOCOL_ID};
  zones.push(z);saveZones();return z;
}
function formatAnchorForRadio(z){
  return{signed:`${z.anchorLat.toFixed(2)} / ${z.anchorLon.toFixed(2)}`};
}

function assertEphemeralCoreAvailable(){
  const missing=[];
  if(typeof roundGrid!=="function")missing.push("roundGrid");
  if(typeof u32be!=="function")missing.push("u32be");
  if(typeof deriveSecretCenter!=="function")missing.push("deriveSecretCenter");
  if(typeof createEphemeralZoneCandidate!=="function")missing.push("createEphemeralZoneCandidate");
  if(typeof saveOrSelectEphemeralZone!=="function")missing.push("saveOrSelectEphemeralZone");
  if(missing.length)throw new Error("Régression interne zones éphémères : fonctions manquantes : "+missing.join(", "));
}
assertEphemeralCoreAvailable();
async function deriveKey(secret,z){
  const master=await deriveMasterKey(secret);
  const b=await hmacBytes(master,"ZONEKEY|"+zoneFingerprint(z));
  return crypto.subtle.importKey("raw",b,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
}
async function hmacBytes(key,text){return new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(text)));}
async function tag9(key,z,index){const h=await hmacBytes(key,`TAG|${zoneFingerprint(z)}|${index}`);return ((h[0]<<8)|h[1])&TAG_MASK;}
async function ackWord(key,z,index,cipher,nacks={}){
  const excluded=Object.values(nacks);
  return responseWordFor(key,`ACK|${zoneFingerprint(z)}|${index}|${cipher>>>0}`,excluded);
}

async function finalConfirmationWord(key,z,index,cipher,ack,nacks={}){
  const excluded=[ack,...Object.values(nacks)];
  return responseWordFor(
    key,
    `FINAL|${zoneFingerprint(z)}|${index}|${cipher>>>0}|${protocolToken(ack)}`,
    excluded
  );
}

function confirmationStem(word){
  return protocolToken(word).slice(0,2);
}

async function finalConfirmationChoices(key,z,index,cipher,ack,finalWord,nacks={}){
  const banned=new Set([finalWord,ack,...Object.values(nacks)].map(protocolToken));
  const chosen=[finalWord];
  const stems=new Set([confirmationStem(finalWord)]);

  for(let round=0; chosen.length<4 && round<32; round++){
    const h=await hmacBytes(
      key,
      `FINAL-CHOICES|${zoneFingerprint(z)}|${index}|${cipher>>>0}|${protocolToken(ack)}|${round}`
    );
    for(const b of h){
      const candidate=ACK_WORDS[b % ACK_WORDS.length];
      const canon=protocolToken(candidate),stem=confirmationStem(candidate);
      if(banned.has(canon) || chosen.some(w=>protocolToken(w)===canon))continue;
      if(stems.has(stem))continue;
      chosen.push(candidate);
      stems.add(stem);
      if(chosen.length===4)break;
    }
  }

  for(const candidate of ACK_WORDS){
    if(chosen.length===4)break;
    const canon=protocolToken(candidate);
    if(banned.has(canon) || chosen.some(w=>protocolToken(w)===canon))continue;
    chosen.push(candidate);
  }

  const order=await hmacBytes(
    key,
    `FINAL-ORDER|${zoneFingerprint(z)}|${index}|${cipher>>>0}|${protocolToken(ack)}`
  );
  const ranked=chosen.map((word,i)=>({word,rank:order[i]}));
  ranked.sort((a,b)=>a.rank-b.rank || protocolToken(a.word).localeCompare(protocolToken(b.word)));
  return ranked.map(x=>x.word);
}
async function roundF(key,round,r){const h=await hmacBytes(key,`F|${round}|${r}`);return ((h[0]<<8)|h[1])&0xFFFF;}
async function feistelEnc(x,key){let l=(x>>>16)&0xFFFF,r=x&0xFFFF;for(let i=0;i<FEISTEL_ROUNDS;i++){const f=await roundF(key,i,r);const nl=r,nr=(l^f)&0xFFFF;l=nl;r=nr;}return ((((l<<16)>>>0)|r)>>>0);}
async function feistelDec(x,key){let l=(x>>>16)&0xFFFF,r=x&0xFFFF;for(let i=FEISTEL_ROUNDS-1;i>=0;i--){const oldR=l;const f=await roundF(key,i,oldR);const oldL=(r^f)&0xFFFF;l=oldL;r=oldR;}return ((((l<<16)>>>0)|r)>>>0);}
function gridFromCoords(lat,lon,z){
  const c=zoneCheck(lat,lon,z);if(!c.inside)throw new Error("Position hors zone.");
  const ix=Math.max(0,Math.min(CELLS-1,Math.floor((c.x+HALF_KM)/CELL_KM)));
  const iy=Math.max(0,Math.min(CELLS-1,Math.floor((c.y+HALF_KM)/CELL_KM)));
  const index=iy*CELLS+ix;return{ix,iy,index,c};
}
function coordsFromIndex(index,z){const iy=Math.floor(index/CELLS),ix=index%CELLS;if(ix<0||ix>=CELLS||iy<0||iy>=CELLS)throw new Error("Index de position invalide.");const x=(ix+0.5)*CELL_KM-HALF_KM,y=(iy+0.5)*CELL_KM-HALF_KM;return{...latLonFromOffset(x,y,z),ix,iy,x,y};}
async function domainEnc(x,key){
  let y=await feistelEnc(x,key);
  while(y>=DOMAIN)y=await feistelEnc(y,key);
  return y;
}
async function domainDec(x,key){
  let y=await feistelDec(x,key);
  while(y>=DOMAIN)y=await feistelDec(y,key);
  return y;
}
function subjectIndex(word){
  let w=norm(word);
  if(w==="URGENTISTE")w="URGENCISTE";
  return SUBJECTS.findIndex(s=>s.w===w);
}
function subjectWord(i){const w=SUBJECTS[i].w;return w==="ZEBRE"?"ZÈBRE":displayWord(w);}
function qualWord(i,gender){const q=QUALS[i];return displayWord(gender==="f"?q.f:q.m);}
function qualIndex(word,gender){
  const w=norm(word);
  return QUALS.findIndex(q=>norm(gender==="f"?q.f:q.m)===w);
}
function phraseFromCipher(c){
  let r=c;
  const q2=r%CODE_BASE;r=Math.floor(r/CODE_BASE);
  const s2=r%CODE_BASE;r=Math.floor(r/CODE_BASE);
  const q1=r%CODE_BASE;r=Math.floor(r/CODE_BASE);
  const s1=r%CODE_BASE;r=Math.floor(r/CODE_BASE);
  const link=r===0?"ET":"OU";
  return {
    connector:link,
    indices:{s1,q1,s2,q2},
    words:[
      subjectWord(s1),
      qualWord(q1,SUBJECTS[s1].g),
      subjectWord(s2),
      qualWord(q2,SUBJECTS[s2].g)
    ]
  };
}
function cipherFromPhrase(words,connector){
  const s1=subjectIndex(words[0]),s2=subjectIndex(words[2]);
  if(s1<0)throw new Error("Premier sujet inconnu : "+norm(words[0]));
  if(s2<0)throw new Error("Second sujet inconnu : "+norm(words[2]));
  const q1=qualIndex(words[1],SUBJECTS[s1].g),q2=qualIndex(words[3],SUBJECTS[s2].g);
  if(q1<0)throw new Error("Premier qualificatif inconnu.");
  if(q2<0)throw new Error("Second qualificatif inconnu.");
  const link=connector==="ET"?0:connector==="OU"?1:-1;
  if(link<0)throw new Error("Choisis ET ou OU.");
  return ((((link*CODE_BASE+s1)*CODE_BASE+q1)*CODE_BASE+s2)*CODE_BASE+q2);
}
function phraseText(p){return `${p.words[0]} ${p.words[1]} ${p.connector} ${p.words[2]} ${p.words[3]}`;}

const PROTOCOL_TEST_VECTOR={
  secret:RESERVED_PROTOCOL_TEST_SECRET,
  fixedZoneId:"rochebonne",
  fixedLat:46.2000,
  fixedLon:-2.4000,
  anchorLat:46.50,
  anchorLon:-3.00,
  expected:{"secretCenter":[47.28042,-3.45013],"zoneAliasCanonical":"SLIPWAY|OIE|OSCAR","phraseCanonical":"THON|MYSTIQUE|ET|ALBATROS|ALTRUISTE","index":3076272,"tag":309,"sessionFingerprintCanonical":"VIRAGE|FLAMANT|AIGUILLAT|MIKE","ackCanonical":"BISCUIT","finalConfirmCanonical":"CLARINETTE","nacksCanonical":{"repeat":"CAMIONNETTE","word1":"SATELLITE","word2":"OIGNON","word3":"ECLIPSE","word4":"METEORE","etou":"MIRABELLE","zone":"BONBON"},"decoded":[46.199817,-2.3999]}
};

async function collectProtocolVector(){
  assertProtocolInvariants();

  const z=BUILTIN_ZONES.find(x=>x.id===PROTOCOL_TEST_VECTOR.fixedZoneId);
  if(!z)throw new Error("Zone test introuvable.");

  const center=await deriveSecretCenter(
    PROTOCOL_TEST_VECTOR.secret,
    PROTOCOL_TEST_VECTOR.anchorLat,
    PROTOCOL_TEST_VECTOR.anchorLon
  );

  const eph={
    id:"test-eph",
    name:"TEST",
    lat:center.lat,
    lon:center.lon,
    anchorLat:PROTOCOL_TEST_VECTOR.anchorLat,
    anchorLon:PROTOCOL_TEST_VECTOR.anchorLon,
    ephemeral:true,
    builtin:false
  };

  const alias=await zoneAlias(PROTOCOL_TEST_VECTOR.secret,eph);

  const enc=await encodeCore(
    PROTOCOL_TEST_VECTOR.fixedLat,
    PROTOCOL_TEST_VECTOR.fixedLon,
    PROTOCOL_TEST_VECTOR.secret,
    z,
    true
  );

  const dec=await decodeCore(
    enc.phrase.words,
    enc.phrase.connector,
    PROTOCOL_TEST_VECTOR.secret,
    z,
    true
  );

  const fp=await sessionFingerprint(PROTOCOL_TEST_VECTOR.secret);

  // On teste exactement les mots produits par la vraie chaîne d'émission,
  // avec le même contexte phrase/zone/cipher que sur le terrain.
  const ack=enc.ack;
  const nacks=enc.nacks;

  const canonPhrase=[
    protocolToken(enc.phrase.words[0]),
    protocolToken(enc.phrase.words[1]),
    protocolToken(enc.phrase.connector),
    protocolToken(enc.phrase.words[2]),
    protocolToken(enc.phrase.words[3])
  ].join("|");

  const canonAlias=[
    ...alias.words.map(protocolToken),
    protocolToken(alias.nato)
  ].join("|");

  const canonFingerprint=[
    ...fp.words.map(protocolToken),
    protocolToken(fp.nato)
  ].join("|");

  const canonNacks={};
  for(const [k,v] of Object.entries(nacks)){
    canonNacks[k]=protocolToken(v);
  }

  return {
    secretCenter:[
      Number(center.lat.toFixed(5)),
      Number(center.lon.toFixed(5))
    ],
    zoneAliasCanonical:canonAlias,
    phraseCanonical:canonPhrase,
    index:enc.index,
    tag:enc.tag,
    sessionFingerprintCanonical:canonFingerprint,
    ackCanonical:protocolToken(ack),
    finalConfirmCanonical:protocolToken(enc.finalConfirm),
    nacksCanonical:canonNacks,
    decoded:[
      Number(dec.lat.toFixed(6)),
      Number(dec.lon.toFixed(6))
    ]
  };
}

async function runProtocolSelfTest(){
  setProtocolRuntimeState(PROTOCOL_STATE.CHECKING);

  try{
    assertProtocolInvariants();

    if(!PROTOCOL_TEST_VECTOR.expected){
      throw new Error("Vecteur de référence non initialisé.");
    }

    const got=await collectProtocolVector();
    const want=PROTOCOL_TEST_VECTOR.expected;

    if(protocolToken(got.ackCanonical)===protocolToken(got.finalConfirmCanonical)){
      throw new Error("ACK et confirmation finale ne doivent pas être identiques.");
    }

    if(JSON.stringify(got)!==JSON.stringify(want)){
      throw new Error(
        `Vecteur protocolaire différent. Attendu ${JSON.stringify(want)} ; obtenu ${JSON.stringify(got)}`
      );
    }

    setProtocolRuntimeState(PROTOCOL_STATE.OK);
    return true;

  }catch(e){
    const detail=e.message||String(e);
    setProtocolRuntimeState(PROTOCOL_STATE.FAILED,detail);
    return false;
  }
}

async function initProtocolRuntime(){
  // L'autotest est volontairement automatique :
  // une version cassée doit se signaler elle-même avant toute communication.
  await runProtocolSelfTest();
}

async function encodeCore(lat,lon,keyText,z,internalSelfTest=false){
  if(!internalSelfTest)assertProtocolReady();
  const g=gridFromCoords(lat,lon,z);
  const key=await deriveKey(keyText,z);
  const tag=await tag9(key,z,g.index);
  const payload=(g.index*TAG_SPACE+tag)>>>0;
  const cipher=await domainEnc(payload,key);
  const phrase=phraseFromCipher(cipher);
  const nacks=await nackTable(keyText,phrase);
  const ack=await ackWord(key,z,g.index,cipher,nacks);
  const finalConfirm=await finalConfirmationWord(key,z,g.index,cipher,ack,nacks);
  return {...g,tag,payload,cipher,phrase,key,ack,finalConfirm,nacks};
}
async function decodeCore(words,connector,keyText,z,internalSelfTest=false){
  if(!internalSelfTest)assertProtocolReady();
  const cipher=cipherFromPhrase(words,connector);
  const phrase={words:[...words],connector};
  const nacks=await nackTable(keyText,phrase);
  const key=await deriveKey(keyText,z);
  const payload=await domainDec(cipher,key);
  const index=Math.floor(payload/TAG_SPACE),receivedTag=payload&TAG_MASK;
  if(index<0||index>=CELLS*CELLS)throw new Error("Phrase invalide pour cette zone.");
  const expected=await tag9(key,z,index);
  if(receivedTag!==expected)throw new Error("Message invalide : mot, ET/OU, zone ou secret de session incorrect.");
  const ack=await ackWord(key,z,index,cipher,nacks);
  const finalConfirm=await finalConfirmationWord(key,z,index,cipher,ack,nacks);
  return {cipher,payload,index,receivedTag,expected,key,ack,finalConfirm,nacks,...coordsFromIndex(index,z)};
}

function formatDegMin(value,isLat){
  const abs=Math.abs(value);
  let deg=Math.floor(abs);
  let min=(abs-deg)*60;

  // Si l'arrondi des minutes produit 60.000, on reporte correctement
  // sur le degré suivant.
  min=Number(min.toFixed(3));
  if(min>=60){
    deg+=1;
    min=0;
  }

  const hemi=isLat
    ? (value>=0?"N":"S")
    : (value>=0?"E":"W");

  const degWidth=isLat?2:3;
  return `${String(deg).padStart(degWidth,"0")}° ${min.toFixed(3).padStart(6,"0")}' ${hemi}`;
}

function formatCoordsBoth(lat,lon){
  const signed=`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const marineLat=formatDegMin(lat,true),marineLon=formatDegMin(lon,false);
  return `<div class="plotter-coordinate">`+
           `<span class="result-fishing-icons" aria-hidden="true">🐟 🎣</span>`+
           `<span class="coord-label">Marine · degrés + minutes décimales</span>`+
           `<strong>${marineLat}</strong>`+
           `<strong>${marineLon}</strong>`+
         `</div>`+
         `<div class="coord-secondary">`+
           `<div><strong>Décimal signé :</strong> ${signed}</div>`+
         `</div>`+
         `<div class="small" style="margin-top:8px">Centre d’une cellule de 100 m. Les deux formats représentent le même point.</div>`;
}

function haversineM(a,b,c,d){const R=6371000,p=Math.PI/180;const x=(c-a)*p,y=(d-b)*p;const q=Math.sin(x/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(q));}

function initialBearingTrueDeg(lat1,lon1,lat2,lon2){
  const p=Math.PI/180,a=lat1*p,b=lat2*p,d=(lon2-lon1)*p;
  const y=Math.sin(d)*Math.cos(b);
  const x=Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(d);
  if(Math.abs(x)<1e-12&&Math.abs(y)<1e-12)return null;
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

let relativePositionMode="marine",relativePositionRevision=0,relativeGpsFix=null;

function relativePositionReady(){
  const d=currentDecodedResult;
  return $("decodedBlock").classList.contains("position-confirmed") &&
    !!d && Number.isFinite(d.lat) && Number.isFinite(d.lon);
}

function clearRelativePositionFields(){
  for(const id of ["relativeLatDeg","relativeLatMin","relativeLonDeg","relativeLonMin","relativeLat","relativeLon"])$(id).value="";
  $("relativeLatHem").value="N";
  $("relativeLonHem").value="E";
}

function setRelativePositionFields(lat,lon){
  const a=decimalAxisToDdm(lat,true),b=decimalAxisToDdm(lon,false);
  if(!a||!b)return;
  $("relativeLatDeg").value=String(a.deg).padStart(2,"0");
  $("relativeLatMin").value=a.min.toFixed(3);
  $("relativeLatHem").value=a.hem;
  $("relativeLonDeg").value=String(b.deg).padStart(3,"0");
  $("relativeLonMin").value=b.min.toFixed(3);
  $("relativeLonHem").value=b.hem;
  $("relativeLat").value=lat.toFixed(6);
  $("relativeLon").value=lon.toFixed(6);
}

function readRelativePosition(){
  if(relativeGpsFix)return{ok:true,lat:relativeGpsFix.lat,lon:relativeGpsFix.lon};
  if(relativePositionMode==="marine"){
    const a=parseDdmAxis("relativeLatDeg","relativeLatMin","relativeLatHem",true);
    const b=parseDdmAxis("relativeLonDeg","relativeLonMin","relativeLonHem",false);
    if(!a.ok)return{ok:false,empty:a.empty&&b.empty,error:a.error};
    if(!b.ok)return{ok:false,empty:false,error:b.error};
    return{ok:true,lat:a.value,lon:b.value};
  }
  const a=String($("relativeLat").value??"").trim();
  const b=String($("relativeLon").value??"").trim();
  if(!a&&!b)return{ok:false,empty:true};
  const lat=parseNum(a),lon=parseNum(b);
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
    return{ok:false,empty:false,error:"Coordonnées invalides : latitude -90 à 90, longitude -180 à 180."};
  }
  return{ok:true,lat,lon};
}

function renderRelativePosition(){
  const result=$("relativePositionResult");
  result.classList.add("hidden");
  if(!relativePositionReady())return;
  const p=readRelativePosition();
  if(!p.ok){
    if(p.empty)hideStatus("relativeInputStatus");
    else setStatus("relativeInputStatus",p.error,"bad");
    return;
  }
  hideStatus("relativeInputStatus");
  const d=currentDecodedResult;
  const metres=haversineM(p.lat,p.lon,d.lat,d.lon);
  const nm=metres/1852,km=metres/1000;
  const bearing=metres<1?null:initialBearingTrueDeg(p.lat,p.lon,d.lat,d.lon);
  const direction=bearing===null
    ?"Tu es au point transmis, à la précision du calcul."
    :`Direction directe : ${String(Math.round(bearing)%360).padStart(3,"0")}° vrai`;
  result.innerHTML=`<strong>Point transmis à ${fmt(nm,nm<1?2:1)} milles nautiques (${fmt(km,km<1?2:1)} km)</strong>`+
    `<span>${direction}</span>`+
    `<div class="small">Depuis ${formatDegMin(p.lat,true)} / ${formatDegMin(p.lon,false)}. Direction géométrique, pas une route tenant compte des dangers ou du courant.</div>`;
  result.classList.remove("hidden");
}

function setRelativePositionMode(mode){
  const p=readRelativePosition();
  relativePositionRevision++;
  relativePositionMode=mode==="decimal"?"decimal":"marine";
  const marine=relativePositionMode==="marine";
  $("relativeMarineInput").classList.toggle("hidden",!marine);
  $("relativeDecimalInput").classList.toggle("hidden",marine);
  $("relativeModeMarine").classList.toggle("active",marine);
  $("relativeModeDecimal").classList.toggle("active",!marine);
  $("relativeModeMarine").setAttribute("aria-pressed",String(marine));
  $("relativeModeDecimal").setAttribute("aria-pressed",String(!marine));
  if(p.ok)setRelativePositionFields(p.lat,p.lon);
  else{
    relativeGpsFix=null;
    clearRelativePositionFields();
  }
  renderRelativePosition();
}

function resetRelativePosition(){
  relativePositionRevision++;
  relativeGpsFix=null;
  clearRelativePositionFields();
  relativePositionMode="marine";
  $("relativeMarineInput").classList.remove("hidden");
  $("relativeDecimalInput").classList.add("hidden");
  $("relativeModeMarine").classList.add("active");
  $("relativeModeDecimal").classList.remove("active");
  $("relativeModeMarine").setAttribute("aria-pressed","true");
  $("relativeModeDecimal").setAttribute("aria-pressed","false");
  hideStatus("relativeGpsStatus");
  hideStatus("relativeInputStatus");
  $("relativePositionResult").innerHTML="";
  $("relativePositionResult").classList.add("hidden");
  $("relativePositionBlock").classList.add("hidden");
}

function onRelativeManualChange(){
  relativePositionRevision++;
  relativeGpsFix=null;
  hideStatus("relativeGpsStatus");
  renderRelativePosition();
}

$("relativeModeMarine").onclick=()=>setRelativePositionMode("marine");
$("relativeModeDecimal").onclick=()=>setRelativePositionMode("decimal");
for(const id of ["relativeLatDeg","relativeLatMin","relativeLonDeg","relativeLonMin","relativeLatHem","relativeLonHem","relativeLat","relativeLon"]){
  $(id).addEventListener(id.endsWith("Hem")?"change":"input",onRelativeManualChange);
}
$("relativeGpsBtn").onclick=()=>{
  if(!relativePositionReady())return;
  if(!navigator.geolocation){
    setStatus("relativeGpsStatus","GPS du téléphone indisponible : saisis ta position manuellement.","bad");
    return;
  }
  const revision=++relativePositionRevision,target=currentDecodedResult;
  setStatus("relativeGpsStatus","Recherche de ta position GPS…","warn gps-searching");
  navigator.geolocation.getCurrentPosition(
    fix=>{
      if(revision!==relativePositionRevision||target!==currentDecodedResult||!relativePositionReady())return;
      const lat=Number(fix.coords.latitude),lon=Number(fix.coords.longitude);
      if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
        setStatus("relativeGpsStatus","Position GPS invalide : saisis ta position manuellement.","bad");
        return;
      }
      const accuracy=Number(fix.coords.accuracy),time=Number(fix.timestamp);
      relativeGpsFix={lat,lon};
      setRelativePositionFields(lat,lon);
      const timeText=Number.isFinite(time)&&time>0
        ?` à ${new Date(time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"";
      const accuracyText=Number.isFinite(accuracy)&&accuracy>=0?` · précision annoncée ±${Math.round(accuracy)} m`:"";
      setStatus("relativeGpsStatus",`Position GPS relevée${timeText}${accuracyText}.`,accuracy>100?"warn":"ok");
      renderRelativePosition();
    },
    error=>{
      if(revision!==relativePositionRevision||target!==currentDecodedResult||!relativePositionReady())return;
      setStatus("relativeGpsStatus",`GPS : ${error.message||"acquisition impossible"}. Saisis ta position manuellement.`,"bad");
    },
    {enableHighAccuracy:true,timeout:60000,maximumAge:0}
  );
};


function returnRow(word,title,action){return `<div class="returnrow"><div class="returnword">${escapeHtml(displayWord(word))}</div><div class="returnaction"><strong>${escapeHtml(title)}</strong>${escapeHtml(action)}</div></div>`;}
function renderSenderReturns(e,z,phrase){
  const w=e.phrase.words;
  $("senderExpectedAckWord").textContent=displayWord(e.ack);
  $("senderFinalConfirmWord").textContent=displayWord(e.finalConfirm);
  const rows=[
    returnRow(e.nacks.word1,"Mot 1 incompris",`Répéter seulement : « ${w[0]} »`),
    returnRow(e.nacks.word2,"Mot 2 incompris",`Répéter seulement : « ${w[1]} »`),
    returnRow(e.nacks.etou,"ET / OU mal compris",`Répéter clairement : « ${e.phrase.connector} »`),
    returnRow(e.nacks.word3,"Mot 3 incompris",`Répéter seulement : « ${w[2]} »`),
    returnRow(e.nacks.word4,"Mot 4 incompris",`Répéter seulement : « ${w[3]} »`),
    returnRow(e.nacks.repeat,"Phrase non validée",`Répéter toute la phrase : « ${phrase} »`)
  ];
  $("senderReturnTable").innerHTML=rows.join("");
}
function showReceiverReply(word,kind,detail,correctionHtml=""){
  if(protocolRuntimeState!==PROTOCOL_STATE.OK){
    hideReceiverReply();
    return;
  }
  const b=$("receiverAckBlock");
  b.classList.remove("hidden","nackbox","provisionalbox");

  if(kind==="provisional" || kind==="ok"){
    b.classList.add("provisionalbox");
    hideReceiverCheckReminder();
    $("receiverReplyLabel").innerHTML='<span class="action-cue"><span class="cue-icon cue-icon-triple">📣📣📣</span><span>3 · À répondre à la VHF — contrôle local réussi</span></span>';
  }else{
    b.classList.add("nackbox");
    showReceiverCheckReminder();
    $("receiverReplyLabel").innerHTML='<span class="action-cue"><span class="cue-icon cue-icon-triple">📣📣📣</span><span>3 · Répondre à la VHF — message non validé</span></span>';
  }

  $("receiverAckWord").textContent=displayWord(word);
  $("receiverReplyDetail").innerHTML=detail;
  $("receiverCorrectionActions").innerHTML=correctionHtml;
}
function hideReceiverReply(){
  $("receiverAckBlock").classList.add("hidden");
  $("receiverCorrectionActions").innerHTML="";
}

function showProvisionalDecodedPosition(lat,lon,metricHtml){
  resetRelativePosition();
  $("decodedBlock").classList.remove("position-confirmed");
  const pill=$("decodedBlock").querySelector(".protocol-state-pill");
  if(pill){
    pill.className="protocol-state-pill protocol-state-provisional";
    pill.textContent="● PROVISOIRE";
  }
  const title=$("decodedBlock").querySelector(".provisional-position-title");
  if(title)title.textContent="🔒 Position non confirmée";
  const explain=$("decodedBlock").querySelector(".provisional-position-explain");
  if(explain)explain.textContent="Le contrôle local a réussi, mais l’émetteur doit encore confirmer l’échange radio.";
  const warning=$("decodedBlock").querySelector(".unconfirmed-position-warning");
  if(warning){
    warning.textContent="⚠ POSITION NON CONFIRMÉE — ne pas la considérer comme validée par l’émetteur.";
  }

  $("decodedCoords").innerHTML=formatCoordsBoth(lat,lon);
  $("decodedOffset").innerHTML=metricHtml;
  $("decodedCoordsWrap").classList.add("hidden");
  $("revealUnconfirmedCoords").classList.remove("hidden");
  $("decodedBlock").classList.remove("hidden");
}

$("revealUnconfirmedCoords").onclick=()=>{
  $("decodedCoordsWrap").classList.remove("hidden");
  $("revealUnconfirmedCoords").classList.add("hidden");
};

async function renderFinalConfirmationChoices(d,z){
  currentDecodedResult=d;
  currentFinalAttemptKey=finalAttemptKey(d,z);
  const box=$("finalConfirmChoices");
  box.innerHTML="";
  $("finalConfirmBlock").classList.remove("final-failed");
  $("noFinalConfirmation").classList.remove("no-confirmation-selected");
  $("newReceptionAfterFailure").classList.add("hidden");

  const choices=await finalConfirmationChoices(
    d.key,z,d.index,d.cipher,d.ack,d.finalConfirm,d.nacks
  );
  currentFinalChoices=choices;

  const alreadyConsumed=consumedFinalAttemptKeys.has(currentFinalAttemptKey);
  finalChoiceLocked=alreadyConsumed;

  for(const word of choices){
    const b=document.createElement("button");
    b.type="button";
    b.className="secondary final-confirm-choice";
    b.textContent=displayWord(word);
    b.dataset.word=protocolToken(word);
    b.disabled=alreadyConsumed;
    b.onclick=()=>handleFinalConfirmationChoice(word,b);
    box.appendChild(b);
  }

  $("noFinalConfirmation").disabled=alreadyConsumed;
  $("finalConfirmBlock").classList.remove("hidden");

  if(alreadyConsumed){
    $("finalConfirmBlock").classList.add("final-failed");
    setStatus(
      "finalConfirmStatus",
      "Cette tentative de confirmation est terminée. Demande à l’émetteur de répéter le mot final, puis démarre une nouvelle tentative radio.",
      "bad"
    );
    $("newReceptionAfterFailure").classList.remove("hidden");
  }else{
    hideStatus("finalConfirmStatus");
  }
}

function lockFinalConfirmationAttempt(){
  if(!currentFinalAttemptKey)return false;
  if(finalChoiceLocked || consumedFinalAttemptKeys.has(currentFinalAttemptKey))return false;

  finalChoiceLocked=true;
  consumedFinalAttemptKeys.add(currentFinalAttemptKey);

  for(const b of $("finalConfirmChoices").querySelectorAll("button")){
    b.disabled=true;
  }
  $("noFinalConfirmation").disabled=true;
  return true;
}

function markPositionConfirmed(){
  if(!currentDecodedResult)return;
  hideReceiverCheckReminder();
  $("decodedBlock").classList.add("position-confirmed");
  const pill=$("decodedBlock").querySelector(".protocol-state-pill");
  if(pill){
    pill.className="protocol-state-pill protocol-state-confirmed";
    pill.textContent="● CONFIRMÉE";
  }
  const title=$("decodedBlock").querySelector(".provisional-position-title");
  if(title)title.textContent="🔓 Position confirmée";
  const explain=$("decodedBlock").querySelector(".provisional-position-explain");
  if(explain)explain.textContent="Le mot final entendu correspond exactement à la confirmation calculée pour cette position.";
  $("decodedCoordsWrap").classList.remove("hidden");
  $("revealUnconfirmedCoords").classList.add("hidden");

  const warning=$("decodedBlock").querySelector(".unconfirmed-position-warning");
  if(warning){
    warning.textContent="POSITION CONFIRMÉE PAR L’ÉCHANGE RADIO COMPLET";
  }
  $("relativeLatHem").value=currentDecodedResult.lat>=0?"N":"S";
  $("relativeLonHem").value=currentDecodedResult.lon>=0?"E":"W";
  $("relativePositionBlock").classList.remove("hidden");
}

function markFinalConfirmationFailed(detail,selectedButton=null){
  showReceiverCheckReminder();
  $("finalConfirmBlock").classList.add("final-failed");

  const pill=$("finalConfirmBlock").querySelector(".protocol-state-pill");
  if(pill){
    pill.className="protocol-state-pill protocol-state-failed";
    pill.textContent="● ÉCHEC";
  }

  if(selectedButton)selectedButton.classList.add("wrong");

  setStatus(
    "finalConfirmStatus",
    detail+" La position reste non confirmée. Demande à l’émetteur de répéter la confirmation, puis touche « J’AI DEMANDÉ DE RÉPÉTER — NOUVELLE TENTATIVE ».",
    "bad"
  );
  $("newReceptionAfterFailure").classList.remove("hidden");

  // La position reste orange/verrouillée. Si l'utilisateur l'avait volontairement
  // révélée auparavant, elle reste explicitement NON CONFIRMÉE.
  const positionPill=$("decodedBlock").querySelector(".protocol-state-pill");
  if(positionPill && !$("decodedBlock").classList.contains("position-confirmed")){
    positionPill.className="protocol-state-pill protocol-state-failed";
    positionPill.textContent="● NON CONFIRMÉE";
  }
}

function handleFinalConfirmationChoice(word,button){
  if(!currentDecodedResult)return;
  if(!lockFinalConfirmationAttempt())return;

  const expected=protocolToken(currentDecodedResult.finalConfirm);
  const got=protocolToken(word);

  if(got===expected){
    button.classList.add("correct");
    hideStatus("finalConfirmStatus");
    $("newReceptionAfterFailure").classList.add("hidden");
    markPositionConfirmed();
    $("decodedBlock").scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }

  markFinalConfirmationFailed(
    "Le mot sélectionné ne correspond pas à la confirmation attendue.",
    button
  );
}

$("noFinalConfirmation").onclick=()=>{
  if(!currentDecodedResult)return;
  if(!lockFinalConfirmationAttempt())return;

  $("noFinalConfirmation").classList.add("no-confirmation-selected");
  markFinalConfirmationFailed(
    "Aucune confirmation exploitable n’a été reçue : silence, demande de répétition, mot différent ou doute."
  );
};

async function tryDecode(words,connector,secret,z){
  try{
    assertProtocolReady();
    return {ok:true,value:await decodeCore(words,connector,secret,z)};
  }catch(error){
    if(protocolRuntimeState!==PROTOCOL_STATE.OK)throw error;
    return {ok:false,error};
  }
}
async function diagnoseFailure(words,connector,secret,z){
  const nacks=await nackTable(secret,{words:[...words],connector});
  try{cipherFromPhrase(words,connector);}catch(error){
    let bad=0;
    for(let i=0;i<4;i++){
      const list=(i===0||i===2)?SUBJECTS.map((s,j)=>subjectWord(j)):(()=>{const si=subjectIndex(words[i===1?0:2]);const g=si>=0?SUBJECTS[si].g:"m";return QUALS.map((q,j)=>qualWord(j,g));})();
      if(!list.some(w=>norm(w)===norm(words[i]))){bad=i;break;}
    }
    return{type:"word",slot:bad,word:nacks["word"+(bad+1)],error};
  }
  const other=connector==="ET"?"OU":"ET";
  const alt=await tryDecode(words,other,secret,z);
  if(alt.ok)return{type:"etou",word:nacks.etou,connector:other,decoded:alt.value};
  return{type:"repeat",word:nacks.repeat};
}

$("useCompatibleZoneBtn").onclick=async()=>{
  refreshEncodeState();
  if($("useCompatibleZoneBtn").disabled)return;
  const p=readActivePosition(),z=selectedZone(sendZone);
  const best=compatibleZones(p.lat,p.lon,z.id)[0];
  if(!best)return;
  try{
    if(!await confirmManualZoneChange(best.z.name,{detail:`Marge au bord : ${fmt(best.c.nearest)} km.`}))return;
    const current=readActivePosition();
    if(!zones.includes(best.z)||!current.ok||!zoneCheck(current.lat,current.lon,best.z).inside){
      throw new Error("La position ou la zone compatible a changé. Vérifie de nouveau.");
    }
    setActiveZone(best.z.id,{invalidate:true,persist:true,refresh:true});
    refreshDecodeState();
    $("sendZone").focus({preventScroll:true});
    const targetId=isAnchoredZone(best.z)?"ephemeralAliasStep":"sendZoneCard";
    $(targetId).scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){setStatus("encodeStatus",e.message||String(e),"bad");}
};

async function encodeSelectedPosition(){
  invalidateEncodedResult();
  const revision=encodeRevision;
  try{

    const z=selectedZone(sendZone),secret=activeSecret();
    if(!validateSessionSecret(secret).ok)throw new Error("Valide d’abord le secret de session en haut de la page.");
    if(!isZoneConfirmed(z)){
      throw new Error("Confirme d’abord l’alias de la zone active avec le correspondant.");
    }

    const p=readActivePosition();
    if(!p.ok)throw new Error(p.error);
    const {lat,lon}=p;

    if(!zoneCheck(lat,lon,z).inside){
      checkDrift();
      throw new Error("Encodage impossible dans cette zone.");
    }

    const e=await encodeCore(lat,lon,secret,z);
    if(revision!==encodeRevision)return null;
    const phrase=phraseText(e.phrase);
    const d=await decodeCore(e.phrase.words,e.phrase.connector,secret,z);
    if(revision!==encodeRevision)return null;
    const err=haversineM(lat,lon,d.lat,d.lon);
    const same=d.index===e.index&&d.receivedTag===e.tag&&
      d.ack===e.ack&&d.finalConfirm===e.finalConfirm;
    if(!same)throw new Error("Contrôle automatique du code échoué. Ne transmets pas cette phrase.");

    $("encodedWords").textContent=phrase;
    $("activeTransmissionTime").textContent="Préparée à "+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    $("encodedBlock").classList.remove("hidden");
    renderSenderReturns(e,z,phrase);
    $("senderAckBlock").classList.remove("hidden");

    $("debugSummary").textContent=`✓ Aller/retour validé — même case #${e.index} — écart au centre de maille : ${err.toFixed(1)} m`;
    $("debugSummary").className="status ok";
    $("debugGrid").innerHTML=
      `<div class="debugcell"><strong>Entrée GPS</strong>${lat.toFixed(6)} / ${lon.toFixed(6)}</div>`+
      `<div class="debugcell"><strong>Grille</strong>X=${e.ix} · Y=${e.iy} · index=${e.index}</div>`+
      `<div class="debugcell"><strong>Tag 9 bits</strong>${e.tag} / 511</div>`+
      `<div class="debugcell"><strong>Code chiffré dans le domaine</strong>${e.cipher}</div>`+
      `<div class="debugcell"><strong>Phrase</strong>${phrase}</div>`+
      `<div class="debugcell"><strong>Retour décodé</strong>${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}<br>`+
      `${Math.abs(d.lat).toFixed(6)}° ${d.lat>=0?"N":"S"} / ${Math.abs(d.lon).toFixed(6)}° ${d.lon>=0?"E":"W"}</div>`+
      `<div class="debugcell"><strong>ACK attendu / recalculé</strong>${e.ack} / ${d.ack}</div>`+
      `<div class="debugcell"><strong>Confirmation finale</strong>${e.finalConfirm} / ${d.finalConfirm}</div>`;
    debugDetailsReady=true;
    refreshDebugDetails();

    return {z,secret,lat,lon,e,phrase,d,err};
  }catch(e){
    if(revision!==encodeRevision)return null;
    throw e;
  }
}

$("encodeBtn").onclick=async()=>{
  try{
    const result=await encodeSelectedPosition();
    if(!result)return;
    if(result.d.index===result.e.index && result.d.receivedTag===result.e.tag &&
       !$("sendPanel").classList.contains("hidden")){
      $("encodedBlock").scrollIntoView({behavior:"smooth",block:"start"});
    }
  }catch(e){
    invalidateEncodedResult();
    setStatus("encodeStatus",e.message||String(e),"bad");
  }
};

$("ephemeralZoneBtn").onclick=async()=>{
  try{
    assertProtocolReady();
    const secret=activeSecret(),sessionRevision=activeSessionRevision,deletionRevision=ephemeralDeletionRevision;
    if(!validateSessionSecret(secret).ok)throw new Error("Valide d’abord le secret de session.");

    const p=readActivePosition();
    if(!p.ok){
      throw new Error(p.empty?"Saisis d’abord la position réelle du bateau ou utilise le GPS.":p.error);
    }
    const {lat,lon}=p;
    if(!shouldOfferEphemeralZone(lat,lon)){
      refreshEncodeState();
      return;
    }

    const picked=await createEphemeralZoneCandidate(lat,lon,secret);
    assertZoneSessionCurrent(secret,sessionRevision);
    assertEphemeralDeletionCurrent(deletionRevision);
    const existing=zones.find(z=>isAnchoredZone(z)&&z.anchorLat===picked.z.anchorLat&&z.anchorLon===picked.z.anchorLon);
    if(existing?.id===activeZoneId){
      setStatus("encodeStatus","Cette zone éphémère est déjà active.","warn");
      return;
    }
    const name=existing?.name||ephemeralLocalLabel();
    if(!await confirmManualZoneChange(name,{
      creation:!existing,
      detail:`Ancre publique : ${picked.z.anchorLat.toFixed(2)} / ${picked.z.anchorLon.toFixed(2)}.`
    }))return;
    assertZoneSessionCurrent(secret,sessionRevision);
    assertEphemeralDeletionCurrent(deletionRevision);
    const latest=readActivePosition();
    if(!latest.ok||latest.lat!==lat||latest.lon!==lon){
      throw new Error("La position a changé pendant la confirmation. Recommence.");
    }
    const z=await saveOrSelectEphemeralZone(picked.z.anchorLat,picked.z.anchorLon,secret,name,sessionRevision,deletionRevision);
    assertZoneSessionCurrent(secret,sessionRevision);

    setActiveZone(z.id,{invalidate:true,persist:true,refresh:false});
    await populateZones(z.id);
    if(activeSessionRevision!==sessionRevision || activeZone()?.id!==z.id)return;

    const c=zoneCheck(lat,lon,z);
    $("ephemeralMetrics").innerHTML=
      `<strong>Contrôle :</strong> ancre publique à ${picked.publicDistance.toFixed(1)} km du bateau · `+
      `bord du carré secret le plus proche ${c.nearest.toFixed(1)} km · centre virtuel non affiché.`;

    setStatus(
      "encodeStatus",
      "Zone éphémère créée et sélectionnée. Annonce l’ancre, compare l’alias avec le correspondant, puis confirme-le pour débloquer la phrase.",
      "warn"
    );
    if(!$("sendPanel").classList.contains("hidden")){
      $("ephemeralBlock").scrollIntoView({behavior:"smooth",block:"start"});
    }
  }catch(e){
    setStatus("encodeStatus",e.message||String(e),"bad");
  }
};

$("sendZoneConfirmBtn").onclick=async()=>{
  hideStatus("encodeStatus");
  try{
    await confirmActiveZoneAlias();
  }catch(e){setStatus("encodeStatus",e.message||String(e),"bad");}
};

$("recvZoneConfirmBtn").onclick=async()=>{
  hideStatus("decodeStatus");
  try{
    await confirmActiveZoneAlias();
  }catch(e){setStatus("decodeStatus",e.message||String(e),"bad");}
};

$("ephemeralAliasConfirmBtn").onclick=async()=>{
  hideStatus("encodeStatus");
  hideStatus("ephemeralConfirmStatus");
  try{
    const z=selectedZone(sendZone);
    if(!isAnchoredZone(z))throw new Error("La zone sélectionnée n’est pas une zone éphémère.");
    await confirmActiveZoneAlias();
    invalidateEncodedResult();
  }catch(e){
    setStatus("ephemeralConfirmStatus",e.message||String(e),"bad");
  }
};

// Réception : saisie contrôlée par le catalogue.
const wordGrid=$("wordGrid");
wordGrid.innerHTML="";
const wordInputs=[];
const wordBoxes=[];
const wordStates=[];
let receiverConnector="";
const connectorButtons={};
let autoDecodeTimer=null;
let decodeRevision=0;
let decodeRunning=false;
let decodeRerunRequested=false;

function vocabularyForSlot(slot){
  if(slot===0||slot===2)return SUBJECTS.map((s,i)=>subjectWord(i));
  const subjectSlot=slot===1?0:2;
  const si=subjectIndex(wordInputs[subjectSlot]?.value||"");
  const gender=si>=0?SUBJECTS[si].g:"m";
  return QUALS.map((q,i)=>qualWord(i,gender));
}

function wordIsExact(slot){
  const value=norm(wordInputs[slot]?.value||"");
  return !!value && vocabularyForSlot(slot).some(w=>norm(w)===value);
}

let currentDecodedResult=null;
let currentFinalChoices=[];
let currentFinalAttemptKey="";
let finalChoiceLocked=false;

// Une tentative finale consommée ne peut pas être rejouée avec RETESTER.
// Elle ne peut être rouverte que par l'action volontaire "J'AI DEMANDÉ DE RÉPÉTER".
const consumedFinalAttemptKeys=new Set();

function finalAttemptKey(d,z){
  return `${PROTOCOL_ID}|${activeSecret()}|${zoneFingerprint(z)}|${d.cipher>>>0}`;
}

function receiverReady(){
  const wordsOk=wordInputs.length===4 && wordInputs.every((_,i)=>wordIsExact(i));
  const connectorOk=!!receiverConnector;
  const secretOk=validateSessionSecret(activeSecret()).ok;
  const zoneOk=isZoneConfirmed(selectedZone(recvZone));
  return wordsOk && connectorOk && secretOk && zoneOk;
}

function receiverCanDecode(){
  return protocolRuntimeState===PROTOCOL_STATE.OK && receiverReady();
}

function invalidateDecodedResult(){
  decodeRevision++;
  resetRelativePosition();
  if(autoDecodeTimer){clearTimeout(autoDecodeTimer);autoDecodeTimer=null;}
  currentDecodedResult=null;
  currentFinalChoices=[];
  currentFinalAttemptKey="";
  finalChoiceLocked=false;

  $("finalConfirmBlock").classList.add("hidden");
  $("finalConfirmBlock").classList.remove("final-failed");
  $("finalConfirmChoices").innerHTML="";
  $("noFinalConfirmation").disabled=false;
  $("noFinalConfirmation").classList.remove("no-confirmation-selected");
  $("newReceptionAfterFailure").classList.add("hidden");
  hideStatus("finalConfirmStatus");

  hideReceiverCheckReminder();
  $("decodedBlock").classList.add("hidden");
  $("decodedBlock").classList.remove("position-confirmed");
  $("decodedCoordsWrap").classList.add("hidden");
  $("revealUnconfirmedCoords").classList.remove("hidden");
  hideReceiverReply();
}

function scheduleAutoDecode(delay=80){
  const ready=receiverCanDecode();
  $("decodeBtn").disabled=!ready;

  if(!ready){
    if(autoDecodeTimer){
      clearTimeout(autoDecodeTimer);
      autoDecodeTimer=null;
    }
    return;
  }

  if(autoDecodeTimer)clearTimeout(autoDecodeTimer);
  const revision=decodeRevision;
  autoDecodeTimer=setTimeout(()=>{
    autoDecodeTimer=null;
    if(revision!==decodeRevision || !receiverCanDecode())return;
    runDecode(true);
  },delay);
}

function refreshDecodeState(){
  scheduleAutoDecode();
}

async function showWordNackIfImpossible(slot){
  if(protocolRuntimeState!==PROTOCOL_STATE.OK)return false;

  const value=norm(wordInputs[slot]?.value||"");
  if(!value)return false;

  const matches=vocabularyForSlot(slot).filter(w=>norm(w).startsWith(value));
  if(matches.length>0)return false;

  const secret=activeSecret();
  if(!validateSessionSecret(secret).ok)return false;

  // Le calcul du NACK est asynchrone. On mémorise l'état courant afin qu'un
  // ancien résultat ne puisse pas réapparaître si l'utilisateur corrige
  // le mot pendant le calcul.
  const revision=decodeRevision;
  const typedValue=value;
  const nacks=await nackTable(secret);

  if(protocolRuntimeState!==PROTOCOL_STATE.OK)return false;
  if(revision!==decodeRevision)return false;
  if(norm(wordInputs[slot]?.value||"")!==typedValue)return false;
  if(vocabularyForSlot(slot).some(w=>norm(w).startsWith(typedValue)))return false;

  const word=nacks["word"+(slot+1)];
  const spokenWord=displayWord(word);

  // Le champ lui-même indique immédiatement quoi dire à la VHF.
  const state=wordStates[slot];
  if(state){
    state.innerHTML=
      `<div class="word-nack-title">⚠ MOT ${slot+1} NON RECONNU</div>`+
      `<div class="word-nack-instruction">Pour faire répéter uniquement le mot ${slot+1}, répondre :</div>`+
      `<div class="word-nack-radio">📣📣📣 <strong>${escapeHtml(spokenWord)}</strong></div>`;
  }

  showReceiverReply(
    word,
    "nack",
    `⚠ MOT ${slot+1} NON RECONNU — ce mot demande uniquement la répétition du mot ${slot+1}.`
  );
  setStatus(
    "decodeStatus",
    `Mot ${slot+1} non reconnu : aucun mot du catalogue ne commence par « ${displayWord(typedValue)} ». Aucun décodage n'est tenté.`,
    "warn"
  );
  showReceiverCheckReminder();
  return true;
}

function updateWordState(slot){
  const inp=wordInputs[slot],box=wordBoxes[slot],state=wordStates[slot];
  const value=norm(inp.value);
  box.classList.remove("valid","invalid");

  if(!value){
    state.textContent="";
    refreshDecodeState();
    return;
  }

  const vocab=vocabularyForSlot(slot);
  if(vocab.some(w=>norm(w)===value)){
    box.classList.add("valid");
    state.textContent="✓ Mot validé";
  }else{
    const possible=vocab.some(w=>norm(w).startsWith(value));
    box.classList.add("invalid");
    state.textContent=possible
      ?"Choisis le mot complet proposé."
      :`⚠ MOT ${slot+1} NON RECONNU — faire répéter ce mot.`;
  }
  refreshDecodeState();
}

function clearWord(slot){
  invalidateDecodedResult();
  wordInputs[slot].value="";
  const sug=wordBoxes[slot].querySelector(".suggestions");
  if(sug)sug.innerHTML="";
  updateWordState(slot);
  hideReceiverReply();
  hideStatus("decodeStatus");
  wordInputs[slot].focus();
}

function nextAfterWord(i){
  if(i===0)return wordInputs[1];
  if(i===1)return connectorButtons.ET;
  if(i===2)return wordInputs[3];
  return null;
}

function renderReceiverConnector(){
  for(const [value,button] of Object.entries(connectorButtons)){
    const selected=receiverConnector===value;
    button.classList.toggle("active",selected);
    button.setAttribute("aria-pressed",String(selected));
  }
}

function selectReceiverConnector(value,{focusNext=true}={}){
  if(value!=="ET" && value!=="OU")return;
  const changed=receiverConnector!==value;
  receiverConnector=value;
  renderReceiverConnector();
  if(changed){
    invalidateDecodedResult();
    hideStatus("decodeStatus");
    refreshDecodeState();
  }
  if(focusNext)wordInputs[2]?.focus();
}

for(let i=0;i<4;i++){
  if(i===2){
    const linkBox=document.createElement("div");
    linkBox.className="linkbox";
    linkBox.setAttribute("role","group");
    linkBox.setAttribute("aria-label","Connecteur entendu à la radio");
    for(const value of ["ET","OU"]){
      const button=document.createElement("button");
      button.type="button";
      button.textContent=value;
      button.setAttribute("aria-pressed","false");
      button.onclick=()=>selectReceiverConnector(value);
      connectorButtons[value]=button;
      linkBox.appendChild(button);
    }
    wordGrid.appendChild(linkBox);
  }

  const box=document.createElement("div");
  box.className="wordbox";

  const inp=document.createElement("input");
  inp.placeholder=i===0?"Sujet 1":i===1?"Qualif 1":i===2?"Sujet 2":"Qualif 2";
  inp.autocomplete="off";
  inp.setAttribute("autocorrect","off");
  inp.setAttribute("autocapitalize","none");
  inp.setAttribute("spellcheck","false");
  inp.dataset.i=i;

  const sug=document.createElement("div");
  sug.className="suggestions";

  const state=document.createElement("div");
  state.className="wordstate";

  const tools=document.createElement("div");
  tools.className="wordtools";
  const clear=document.createElement("button");
  clear.type="button";
  clear.className="wordclear";
  clear.textContent="EFFACER";
  clear.onclick=()=>clearWord(i);
  tools.appendChild(clear);

  inp.addEventListener("input",async()=>{
    invalidateDecodedResult();
    hideStatus("decodeStatus");
    inp.value=norm(inp.value);
    sug.innerHTML="";

    const q=inp.value;
    let matches=[];
    if(q.length>=1){
      matches=vocabularyForSlot(i).filter(w=>norm(w).startsWith(q));
      for(const w of matches){
        const b=document.createElement("button");
        b.type="button";
        b.textContent=w;
        b.onclick=()=>{
          invalidateDecodedResult();
          hideStatus("decodeStatus");
          inp.value=w;
          sug.innerHTML="";
          updateWordState(i);

          // Si un sujet vient d'être changé, le qualificatif associé doit être revalidé.
          if(i===0 && wordInputs[1].value)updateWordState(1);
          if(i===2 && wordInputs[3].value)updateWordState(3);

          const next=nextAfterWord(i);
          if(next)next.focus();
        };
        sug.appendChild(b);
      }
    }

    updateWordState(i);

    // Tant que la frappe reste le préfixe d'un mot possible, l'autocomplétion
    // continue normalement et aucun NACK n'est affiché.
    if(q && matches.length===0){
      await showWordNackIfImpossible(i);
    }

    // Un changement de sujet peut rendre impossible un qualificatif déjà saisi.
    if(i===0 && wordInputs[1].value){
      updateWordState(1);
      await showWordNackIfImpossible(1);
    }
    if(i===2 && wordInputs[3].value){
      updateWordState(3);
      await showWordNackIfImpossible(3);
    }
  });

  // Filet de sécurité pour collage, saisie assistée ou comportement de clavier mobile.
  inp.addEventListener("blur",()=>{showWordNackIfImpossible(i);});

  box.append(inp,sug,state,tools);
  wordGrid.appendChild(box);
  wordInputs.push(inp);
  wordBoxes.push(box);
  wordStates.push(state);
}

$("decodeBtn").disabled=true;

async function runDecode(automatic=false){
  if(!receiverReady())return;
  if(decodeRunning){decodeRerunRequested=true;return;}

  const myRevision=decodeRevision,stale=()=>myRevision!==decodeRevision;
  decodeRunning=true;decodeRerunRequested=false;$("decodeBtn").disabled=true;
  setStatus("decodeStatus",automatic?"Phrase complète : vérification automatique…":"Nouvelle vérification…","warn");

  try{
    const z=selectedZone(recvZone),secret=activeSecret();
    if(!validateSessionSecret(secret).ok)throw new Error("Valide d’abord le secret de session en haut de la page.");

    // Une panne interne ne doit jamais être convertie en erreur de transmission
    // et donc ne doit jamais produire de NACK.
    assertProtocolReady();

    const words=wordInputs.map(x=>norm(x.value)),connector=receiverConnector;

    for(let i=0;i<4;i++){
      if(!wordIsExact(i)){
        const nacks=await nackTable(secret);if(stale())return;
        showReceiverReply(nacks["word"+(i+1)],"nack",`Le mot ${i+1} n'est pas validé dans le catalogue. Demande seulement la répétition du mot ${i+1}.`);
        setStatus("decodeStatus",`Mot ${i+1} invalide : aucun décodage n'a été tenté.`,"warn");return;
      }
    }
    if(!connector)throw new Error("Choisis ET ou OU.");

    const direct=await tryDecode(words,connector,secret,z);if(stale())return;
    if(direct.ok){
      const d=direct.value;
      showProvisionalDecodedPosition(
        d.lat,
        d.lon,
        `Case #${d.index} — contrôle local 9 bits réussi.`
      );
      showReceiverReply(
        d.ack,
        "provisional",
        "Annonce ce mot à la VHF. Ensuite écoute le mot final de l’émetteur et sélectionne-le parmi les quatre choix."
      );
      await renderFinalConfirmationChoices(d,z);
      if(stale())return;
      setStatus(
        "decodeStatus",
        "Contrôle local réussi (9 bits) — position provisoire jusqu’au mot final.",
        "warn"
      );
      return;
    }

    const diag=await diagnoseFailure(words,connector,secret,z);if(stale())return;
    if(diag.type==="etou"){
      showProvisionalDecodedPosition(
        diag.decoded.lat,
        diag.decoded.lon,
        `<strong>NON CONFIRMÉ</strong> — correction probable : ${diag.connector}`
      );
      showReceiverReply(diag.word,"nack",`L'autre connecteur <strong>${diag.connector}</strong> valide le contrôle. Demande confirmation à l'émetteur avant d'accepter les coordonnées.`,`<button class="secondary" id="applyConnector">Après confirmation : appliquer ${diag.connector}</button>`);
      setTimeout(()=>{const b=$("applyConnector");if(b)b.onclick=()=>selectReceiverConnector(diag.connector,{focusNext:false});},0);
      setStatus("decodeStatus","Correction probable ET/OU trouvée, mais pas encore confirmée.","warn");return;
    }
    if(diag.type==="word"){
      showReceiverReply(diag.word,"nack",`Le mot ${diag.slot+1} n'est pas reconnu : demande uniquement sa répétition.`);setStatus("decodeStatus",`Message non validé : mot ${diag.slot+1} incorrect.`,"warn");return;
    }

    showReceiverReply(
      diag.word,
      "nack",
      "Ce mot demande de répéter toute la phrase. Si la répétition est identique et que le message échoue encore, vérifie la SESSION ACTIVE et surtout l’ALIAS ZONE ACTIVE rappelés juste au-dessus."
    );
    setStatus(
      "decodeStatus",
      "Message non validé : aucune cause unique ne peut être déterminée en sécurité. Répète d’abord la phrase, puis vérifie session et alias si l’échec persiste.",
      "warn"
    );
  }catch(e){
    if(!stale()){
      setStatus("decodeStatus",e.message||String(e),"bad");
      showReceiverCheckReminder();
    }
  }
  finally{
    decodeRunning=false;$("decodeBtn").disabled=!receiverCanDecode();
    const rerun=stale()||decodeRerunRequested;decodeRerunRequested=false;
    if(rerun&&receiverCanDecode())scheduleAutoDecode(0);
  }
}

$("decodeBtn").onclick=()=>runDecode(false);

function clearReceivedMessage({focus=true}={}){
  // Effacement manuel explicite : on repart réellement sur une nouvelle phrase.
  consumedFinalAttemptKeys.clear();
  invalidateDecodedResult();

  wordInputs.forEach((_,i)=>{
    wordInputs[i].value="";
    const sug=wordBoxes[i].querySelector(".suggestions");
    if(sug)sug.innerHTML="";
    updateWordState(i);
  });

  receiverConnector="";
  renderReceiverConnector();
  hideStatus("decodeStatus");
  $("decodedBlock").classList.add("hidden");
  hideReceiverReply();
  refreshDecodeState();

  if(focus){
    wordInputs[0].focus();
    try{
      wordInputs[0].scrollIntoView({behavior:"smooth",block:"center"});
    }catch(_){}
  }
}

function clearExchangeInputsForNewOuting(){
  clearSenderPositionInputs();
  clearReceivedMessage({focus:false});
}

function retryFinalRadioConfirmation(){
  // Nouvelle tentative RADIO uniquement :
  // on garde la phrase, ET/OU, la zone et la position provisoire.
  if(!currentDecodedResult || !currentFinalAttemptKey)return;

  consumedFinalAttemptKeys.delete(currentFinalAttemptKey);
  finalChoiceLocked=false;
  resetRelativePosition();

  $("finalConfirmBlock").classList.remove("final-failed");
  $("newReceptionAfterFailure").classList.add("hidden");
  $("noFinalConfirmation").disabled=false;
  $("noFinalConfirmation").classList.remove("no-confirmation-selected");

  const pill=$("finalConfirmBlock").querySelector(".protocol-state-pill");
  if(pill){
    pill.className="protocol-state-pill protocol-state-wait";
    pill.textContent="● CONFIRMATION FINALE";
  }

  for(const b of $("finalConfirmChoices").querySelectorAll("button")){
    b.disabled=false;
    b.classList.remove("wrong","correct");
  }

  // La position reste provisoire / non confirmée jusqu'au bon mot final.
  $("decodedBlock").classList.remove("position-confirmed");
  const positionPill=$("decodedBlock").querySelector(".protocol-state-pill");
  if(positionPill){
    positionPill.className="protocol-state-pill protocol-state-provisional";
    positionPill.textContent="● PROVISOIRE";
  }
  const positionTitle=$("decodedBlock").querySelector(".provisional-position-title");
  if(positionTitle)positionTitle.textContent="🔒 Position non confirmée";

  hideStatus("finalConfirmStatus");
  setStatus(
    "decodeStatus",
    "Nouvelle tentative radio : écoute à nouveau uniquement le mot final de l’émetteur.",
    "warn"
  );

  try{
    $("finalConfirmBlock").scrollIntoView({behavior:"smooth",block:"center"});
  }catch(_){}
}

$("clearWords").onclick=clearReceivedMessage;
$("newReceptionAfterFailure").onclick=retryFinalRadioConfirmation;



// Secret de session persistant.
async function installValidatedSecret(secret,persist=true,createdAt=null){
  const v=validateOperationalSessionSecret(secret);if(!v.ok)throw new Error(v.msg);
  const previous=appStorage.getItem(SESSION_SECRET_KEY)||"",changed=previous!==v.canonical;
  if(changed){
    hideOutingSuccessDialog();
    clearZoneConfirmations();
    consumedFinalAttemptKeys.clear();

    // Une phrase/ACK/mot final préparés avec l'ancienne session ne doivent
    // jamais rester visibles après un changement de secret.
    invalidateEncodedResult();
    setStatus(
      "encodeStatus",
      previous
        ?"SESSION CHANGÉE — l’ancienne transmission a été annulée. Confirme l’alias puis génère une nouvelle phrase."
        :"Session active",
      previous?"warn":"ok"
    );
  }
  if(persist){
    if(changed){
      purgeEphemeralZones();
      appStorage.removeItem(OUTING_ID_KEY);
      appStorage.removeItem(OUTING_ORIGIN_KEY);
      appStorage.removeItem(OUTING_INSTALLED_AT_KEY);
    }
    if(changed || !sessionCreatedAt() || createdAt!==null){
      appStorage.setItem(SESSION_CREATED_AT_KEY,String(createdAt??Date.now()));
    }
    appStorage.setItem(SESSION_SECRET_KEY,v.canonical);
  }
  syncSavedSecret(v.canonical);
  const revision=activeSessionRevision;
  loadZoneConfirmations();
  const fingerprint=await showSessionFingerprint(v.canonical);
  if(!fingerprint || activeSecret()!==v.canonical || activeSessionRevision!==revision)return null;
  await refreshZoneAliases();
  if(activeSecret()!==v.canonical || activeSessionRevision!==revision)return null;
  invalidateDecodedResult();
  refreshZoneConfirmationUi();
  refreshDecodeState();
  refreshEphemeralWorkflow();
  return v;
}

initVersionUi();
initTheme();
const appCompatReady=initProtocolCompat();
const appRuntimeReady=initProtocolRuntime();

const appSessionReady=(async function initSessionSecret(){
  const saved=appStorage.getItem(SESSION_SECRET_KEY)||"";
  if(!saved){
    syncSavedSecret("");
    hideSessionFingerprint();
    return;
  }
  const pending=installValidatedSecret(saved,false);
  const revision=activeSessionRevision;
  try{
    const v=await pending;
    if(!v || activeSecret()!==saved || activeSessionRevision!==revision)return;
  }catch{
    if(activeSessionRevision!==revision)return;
    appStorage.removeItem(SESSION_SECRET_KEY);
    syncSavedSecret("");
    hideSessionFingerprint();
  }
})();

const OUTING_BEGIN="----- DEBUT INVITATION VHF-GPS -----";
const OUTING_END="----- FIN INVITATION VHF-GPS -----";
function canShareOutingText(text){
  if(typeof navigator.share!=="function")return false;
  try{return typeof navigator.canShare!=="function"||navigator.canShare({text});}
  catch{return false;}
}
function refreshOutingShareControls(){
  const available=!!outingShareReady&&canShareOutingText(outingShareReady.text);
  $("nativeShareOutingBtn").classList.toggle("hidden",!available);
  $("nativeShareOutingBtn").disabled=!available||outingCopyBusy;
  $("copyOutingMessageBtn").disabled=!outingShareReady||outingCopyBusy;
}
function clearOutingShare(){
  outingShareRevision++;
  outingShareReady=null;
  outingCopyBusy=false;
  $("outingShareText").value="";
  refreshOutingShareControls();
  if($("outingShareDialog").open){
    setStatus("outingShareStatus","La session ou la zone active a changé. Ferme cette fenêtre et rouvre l'invitation.","warn");
  }else hideStatus("outingShareStatus");
}

function randomOutingId(){
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
}

function outingDate(ms){
  return new Date(ms).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"});
}

function outingZoneDescriptor(z){
  if(z.builtin)return{type:"builtin",id:z.id};
  if(isAnchoredZone(z))return{type:"ephemeral",lat:z.anchorLat,lon:z.anchorLon};
  throw new Error("Le partage des zones personnalisées fixes n'est pas encore disponible.");
}
function outingZoneVisibleLabel(zone){
  return zone.type==="builtin"
    ?BUILTIN_ZONES.find(z=>z.id===zone.id)?.name||"Zone intégrée"
    :`${OUTING_EPHEMERAL_NAME} · ancre ${Number(zone.lat).toFixed(2)} / ${Number(zone.lon).toFixed(2)}`;
}
function saveOutingOrigin(id,z){
  appStorage.setItem(OUTING_ORIGIN_KEY,JSON.stringify({id,zoneId:z.id,fingerprint:zoneFingerprint(z)}));
}
function outingMatchesOriginalZone(z){
  if(!z)return false;
  try{
    const origin=JSON.parse(appStorage.getItem(OUTING_ORIGIN_KEY)||"null");
    return !!origin && origin.id===appStorage.getItem(OUTING_ID_KEY) &&
      origin.zoneId===z.id && origin.fingerprint===zoneFingerprint(z);
  }catch{return false;}
}

function canShareActiveOuting(){
  const z=activeZone(),supported=!!z&&(!!z.builtin||isAnchoredZone(z));
  return supported&&validateOperationalSessionSecret(activeSecret()).ok&&
    outingMatchesOriginalZone(z)&&isZoneConfirmed(z);
}
function refreshOutingActions(){
  $("backHomeBtn").disabled=outingMutationBusy||outingCopyBusy;
  $("shareOutingBtn").classList.toggle("hidden",!canShareActiveOuting());
  $("shareOutingBtn").disabled=outingMutationBusy||outingCopyBusy;
  const created=sessionCreatedAt();
  const installed=appStorage.getItem(OUTING_ID_KEY)
    ?Number(appStorage.getItem(OUTING_INSTALLED_AT_KEY)||0):0;
  const times=$("outingLocalTimes"),showInstalled=!!created&&Number.isFinite(installed)&&installed>0;
  times.textContent=showInstalled?`Sortie installée sur ce téléphone le ${outingDate(installed)}.`:"";
  times.classList.toggle("hidden",!showInstalled);
}

function utf8Base64Url(text){
  const bytes=new TextEncoder().encode(text);
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

function base64UrlUtf8(value){
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error("Code d'invitation invalide.");
  const binary=atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="));
  return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));
}

async function outingChecksum(code){
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code)));
  return [...bytes.slice(0,8)].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
}

async function activeOutingPayload(){
  assertProtocolReady();
  const secret=activeSecret(),z=activeZone(),revision=activeSessionRevision,zoneId=z?.id;
  if(!validateOperationalSessionSecret(secret).ok)throw new Error("Active d'abord une session valide.");
  if(!z)throw new Error("Choisis d'abord une zone.");
  const zone=outingZoneDescriptor(z);
  if(!isZoneConfirmed(z))throw new Error("Confirme d'abord l'alias de la zone active.");
  const id=appStorage.getItem(OUTING_ID_KEY);
  if(!id||!outingMatchesOriginalZone(z)){
    throw new Error("La zone active ne correspond pas à la sortie créée ou importée. Reviens à sa zone d'origine ou réinstalle l'invitation.");
  }
  const [compat,fp,alias]=await Promise.all([
    protocolCompatDigestHex(),sessionFingerprint(secret),zoneAlias(secret,z)
  ]);
  if(activeSessionRevision!==revision||activeSecret()!==secret||activeZone()?.id!==zoneId||
      appStorage.getItem(OUTING_ID_KEY)!==id||!outingMatchesOriginalZone(z)||!isZoneConfirmed(z)){
    throw new Error("La session ou la zone a changé pendant la préparation. Recommence.");
  }
  const createdAt=sessionCreatedAt()||Date.now();
  return{v:1,proto:PROTOCOL_ID,compat,secret,createdAt,id,zone,
    fingerprint:`${fp.words.join(" · ")} | ${fp.nato}`,alias:alias.text};
}

async function formatRawOutingInvitation(payload){
  const encoded=utf8Base64Url(JSON.stringify(payload));
  const prefix=`VHF1.${encoded}`;
  const token=`${prefix}.${await outingChecksum(prefix)}`;
  const zone=outingZoneVisibleLabel(payload.zone);
  return `🎣 Invitation pour une sortie VHF-GPS\n🗓️ Créée le ${outingDate(payload.createdAt)}\n📍 Zone : ${zone}\n🔧 ${protocolShortLabel()} · COMPAT ${payload.compat.slice(0,8)}\n🔐 Alias de session (empreinte radio) : ${payload.fingerprint}\n📣 Alias de zone : ${payload.alias}\n\n📲 Ouvre l'application installée, touche « Recevoir une invitation », puis colle ce message entier.\n⚠️ Envoyez cette invitation telle quelle. Tous les participants doivent installer ce même message. Ne modifiez pas le code et ne le transférez qu'aux participants de la sortie.\n\n${OUTING_BEGIN}\n${token}\n${OUTING_END}`;
}

function extractOutingToken(input){
  const text=String(input||"");
  if(text.length>12000)throw new Error("Message trop long pour une invitation.");
  const start=text.indexOf(OUTING_BEGIN);
  const end=start>=0?text.indexOf(OUTING_END,start+OUTING_BEGIN.length):-1;
  if(start<0||end<0||end<=start){
    const direct=text.trim();
    if(/^VHF1\.[A-Za-z0-9_-]+\.[A-Fa-f0-9]{16}$/.test(direct))return direct;
    throw new Error("Bloc d'invitation introuvable. Colle le message complet.");
  }
  if(text.indexOf(OUTING_BEGIN,start+OUTING_BEGIN.length)>=0||text.indexOf(OUTING_END,end+OUTING_END.length)>=0){
    throw new Error("Plusieurs invitations trouvées : colle un seul message.");
  }
  const token=text.slice(start+OUTING_BEGIN.length,end).replace(/\s+/g,"");
  if(!/^VHF1\.[A-Za-z0-9_-]+\.[A-Fa-f0-9]{16}$/.test(token))throw new Error("Code d'invitation incomplet ou modifié.");
  return token;
}

async function inspectOutingInvitation(input){
  assertProtocolReady();
  const token=extractOutingToken(input),parts=token.split(".");
  if(await outingChecksum(`${parts[0]}.${parts[1]}`)!==parts[2].toUpperCase()){
    throw new Error("Code modifié ou mal copié : contrôle d'intégrité incorrect.");
  }
  let data;
  try{data=JSON.parse(base64UrlUtf8(parts[1]));}
  catch{throw new Error("Contenu de l'invitation illisible.");}
  if(!data||data.v!==1||data.proto!==PROTOCOL_ID){
    throw new Error(`Protocole incompatible : cette application utilise ${protocolShortLabel()}. Mets les téléphones à jour avant la sortie.`);
  }
  const compat=await protocolCompatDigestHex();
  if(data.compat!==compat)throw new Error("COMPAT différent : les deux applications ne peuvent pas échanger. Mets-les à jour.");
  const v=validateOperationalSessionSecret(data.secret);
  if(!v.ok||v.canonical!==data.secret)throw new Error("Secret invalide dans l'invitation.");
  if(!Number.isSafeInteger(data.createdAt)||data.createdAt<Date.UTC(2020,0,1)||data.createdAt>Date.UTC(2200,0,1)){
    throw new Error("Date de création invalide dans l'invitation.");
  }
  if(typeof data.id!=="string"||!/^([A-F0-9]{32})$/.test(data.id))throw new Error("Identifiant de sortie invalide.");
  let zone;
  if(data.zone?.type==="builtin"&&typeof data.zone.id==="string"){
    zone=BUILTIN_ZONES.find(z=>z.id===data.zone.id);
    if(!zone)throw new Error("Zone intégrée inconnue dans l'invitation.");
  }else if(data.zone?.type==="ephemeral"){
    assertValidPublicAnchor(data.zone.lat,data.zone.lon);
    const center=await deriveSecretCenter(data.secret,data.zone.lat,data.zone.lon);
    zone={id:"invitation-preview",name:OUTING_EPHEMERAL_NAME,...center,ephemeral:true,protocolId:PROTOCOL_ID};
  }else throw new Error("Type de zone non pris en charge dans l'invitation.");
  const [fp,alias]=await Promise.all([sessionFingerprint(data.secret),zoneAlias(data.secret,zone)]);
  const fingerprint=`${fp.words.join(" · ")} | ${fp.nato}`;
  if(data.fingerprint!==fingerprint||data.alias!==alias.text){
    throw new Error("Empreinte ou alias incohérent : invitation modifiée ou incompatible.");
  }
  const visible=String(input).split(OUTING_BEGIN)[0];
  const headingAt=visible.lastIndexOf("Invitation pour une sortie VHF-GPS");
  const lines=headingAt<0?[]:visible.slice(headingAt).split(/\r?\n/).reverse();
  const fingerprintLabel="Alias de session (empreinte radio) : ",aliasLabel="Alias de zone : ";
  const visibleFingerprint=lines.find(line=>line.startsWith(fingerprintLabel)||line.startsWith("🔐 "+fingerprintLabel));
  const visibleAlias=lines.find(line=>line.startsWith(aliasLabel)||line.startsWith("📣 "+aliasLabel));
  const fingerprintValue=visibleFingerprint?.replace(/^🔐 /u,"").slice(fingerprintLabel.length).trim();
  const aliasValue=visibleAlias?.replace(/^📣 /u,"").slice(aliasLabel.length).trim();
  const visibleZone=lines.find(line=>line.startsWith("Zone : ")||line.startsWith("📍 Zone : "));
  const zoneValue=visibleZone?.replace(/^📍 /u,"").slice("Zone : ".length).trim();
  const visibleCompat=lines.find(line=>line.startsWith("PROTO")||line.startsWith("🔧 PROTO"));
  const compatValue=visibleCompat?.replace(/^🔧 /u,"").trim();
  if((visibleFingerprint&&fingerprintValue!==fingerprint)||
     (visibleAlias&&aliasValue!==alias.text)||
     (visibleZone&&zoneValue!==outingZoneVisibleLabel(data.zone))||
     (visibleCompat&&compatValue!==`${protocolShortLabel()} · COMPAT ${data.compat.slice(0,8)}`)){
    throw new Error("Le résumé lisible ne correspond pas au code d'invitation. Demande un nouveau message complet.");
  }
  return{data,zone,fingerprint,alias:alias.text};
}

function showOutingImportSummary(prepared){
  const {data,zone,fingerprint,alias}=prepared;
  const summary=$("outingImportSummary");
  summary.innerHTML="";
  const rows=[
    ["Création de la sortie",outingDate(data.createdAt)],
    ["Installation sur ce téléphone",appStorage.getItem(OUTING_ID_KEY)===data.id&&Number(appStorage.getItem(OUTING_INSTALLED_AT_KEY)||0)
      ?outingDate(Number(appStorage.getItem(OUTING_INSTALLED_AT_KEY))):"Après confirmation"],
    ["Compatibilité",`${protocolShortLabel()} · COMPAT ${data.compat.slice(0,8)}`],
    ["Empreinte de session",fingerprint],
    ["Zone",data.zone.type==="builtin"?zone.name:`${OUTING_EPHEMERAL_NAME} · ancre ${zone.anchorLat.toFixed(2)} / ${zone.anchorLon.toFixed(2)}`],
    ["Alias de zone",alias]
  ];
  for(const [label,value] of rows){
    const row=document.createElement("div"),heading=document.createElement("strong"),text=document.createElement("span");
    heading.textContent=label;text.textContent=value;row.append(heading,text);summary.appendChild(row);
  }
  const replacing=!!activeSecret()&&(activeSecret()!==data.secret||zoneFingerprint(activeZone())!==zoneFingerprint(zone));
  const warning=$("outingImportWarning");
  const notices=[];
  if(replacing)notices.push("Attention : cette sortie remplacera la session ou la zone actuellement active. Toute transmission préparée devra être recommencée.");
  if(data.createdAt>Date.now()+3600000)notices.push("La date de création est dans le futur. Vérifie l'horloge des téléphones.");
  if(Date.now()-data.createdAt>24*3600000)notices.push("Cette session a plus de 24 h : vérifie qu'il s'agit bien de la sortie en cours.");
  if(notices.length)setStatus("outingImportWarning",notices.join(" "),"warn");
  else warning.classList.add("hidden");
  hideStatus("outingImportDialogError");
  $("outingImportVerified").classList.remove("hidden");
  summary.classList.remove("hidden");
}

// Restauration compensatoire des erreurs pendant une installation en cours.
// Les révisions restent croissantes : un ancien calcul ne peut pas redevenir valide.
// Ce garde-fou ne remplace pas une transaction persistante face à un arrêt brutal.
async function withOutingRollback(install){
  const keys=[SESSION_SECRET_KEY,SESSION_CREATED_AT_KEY,OUTING_ID_KEY,
    OUTING_INSTALLED_AT_KEY,OUTING_ORIGIN_KEY,ACTIVE_ZONE_STORAGE_KEY,
    ZONE_CONFIRM_STORAGE_KEY,"vhfGpsZonesV4Custom"];
  const saved={
    storage:keys.map(key=>[key,appStorage.getItem(key)]),
    secret:activeSecret(),zones:zones.map(z=>({...z})),zoneId:activeZoneId,
    confirmed:[...confirmedZoneIds],manual:[...manualConfirmedZoneIds],
    auto:outingAutoConfirmedZoneId,attempts:[...consumedFinalAttemptKeys],
    fingerprint:$("fingerprintWords").textContent,
    fingerprintHidden:$("fingerprintBlock").classList.contains("hidden")
  };
  const owner={
    revision:activeSessionRevision,zoneRevision:activeZoneRevision,
    capture(){this.revision=activeSessionRevision;this.zoneRevision=activeZoneRevision;},
    current(){return this.revision===activeSessionRevision&&this.zoneRevision===activeZoneRevision;},
    check(){if(!this.current())throw new Error("La session ou la zone a changé pendant l'installation. Recommence.");}
  };
  try{return await install(owner);}
  catch(error){
    // Une autre action a pris la main : ne jamais remettre une ancienne sortie dessus.
    if(!owner.current())throw error;
    let storageFailure=false;
    for(const [key,value] of saved.storage){
      try{
        if(appStorage.getItem(key)!==value){
          if(value===null)appStorage.removeItem(key);
          else appStorage.setItem(key,value);
        }
      }catch{storageFailure=true;}
    }
    activeSessionRevision++;
    zones=saved.zones;
    activeZoneId=saved.zoneId;
    activeZoneRevision++;
    confirmedZoneIds.clear();saved.confirmed.forEach(id=>confirmedZoneIds.add(id));
    manualConfirmedZoneIds.clear();saved.manual.forEach(id=>manualConfirmedZoneIds.add(id));
    outingAutoConfirmedZoneId=saved.auto;
    consumedFinalAttemptKeys.clear();saved.attempts.forEach(key=>consumedFinalAttemptKeys.add(key));
    syncSavedSecret(storageFailure?"":saved.secret);
    invalidateEncodedResult();invalidateDecodedResult();
    if(storageFailure){
      confirmedZoneIds.clear();manualConfirmedZoneIds.clear();outingAutoConfirmedZoneId=null;
      hideSessionFingerprint();refreshZoneConfirmationUi();refreshDecodeState();
      try{await populateZones(saved.zoneId);}catch{}
      throw new Error("La restauration de la sortie a échoué. Réinstalle son invitation avant de reprendre.");
    }
    $("fingerprintWords").textContent=saved.fingerprint;
    $("fingerprintBlock").classList.toggle("hidden",saved.fingerprintHidden);
    owner.capture();
    try{await populateZones(saved.zoneId);}
    catch{
      // Le stockage précédent est restauré, mais une panne de rendu/calcul persiste.
      if(owner.current()){
        syncSavedSecret("");hideSessionFingerprint();
        refreshZoneAliases().catch(()=>{});refreshEphemeralWorkflow().catch(()=>{});
        refreshZoneConfirmationUi();refreshDecodeState();
      }
      throw new Error("La sortie précédente est enregistrée, mais son affichage a échoué. Rouvre l'application avant de reprendre.");
    }
    if(owner.current()){
      refreshZoneConfirmationUi();refreshEncodeState();refreshDecodeState();refreshOutingActions();
    }
    throw error;
  }
}

async function installOutingInvitation(prepared){
  const {data,zone}=prepared;
  const same=appStorage.getItem(OUTING_ID_KEY)===data.id&&activeSecret()===data.secret&&
    zoneFingerprint(activeZone())===zoneFingerprint(zone)&&isZoneConfirmed(activeZone())&&
    outingMatchesOriginalZone(activeZone())&&
    (data.zone.type!=="ephemeral"||(isOutingEphemeral(activeZone())&&sameZoneCenter(activeZone(),zone)));
  if(same)return"Cette sortie est déjà installée et active.";
  return withOutingRollback(async owner=>{
    const oldId=appStorage.getItem(OUTING_ID_KEY);
    const installing=installValidatedSecret(data.secret,true,data.createdAt);
    owner.capture();
    const installed=await installing;
    owner.check();
    if(!installed)throw new Error("La session a changé pendant l'installation. Recommence.");
    let target=zone;
    if(data.zone.type==="ephemeral"){
      target=zones.find(z=>z.ephemeral&&isAnchoredZone(z)&&
        z.anchorLat===zone.anchorLat&&z.anchorLon===zone.anchorLon);
      if(!target){
        target={...zone,id:`eph-${Date.now()}-${secureRandomIndex(1000000)}`,
          name:OUTING_EPHEMERAL_NAME,outingId:data.id,builtin:false,createdAt:Date.now()};
        zones.push(target);saveZones();
      }else if(target.outingId!==data.id||target.name!==OUTING_EPHEMERAL_NAME||!sameZoneCenter(target,zone)){
        target.lat=zone.lat;
        target.lon=zone.lon;
        target.outingId=data.id;
        target.name=OUTING_EPHEMERAL_NAME;
        delete target.importedOuting;
        saveZones();
      }
    }
    try{setActiveZone(target.id,{invalidate:true,persist:true,refresh:false});}
    finally{owner.capture();}
    confirmedZoneIds.add(target.id);
    manualConfirmedZoneIds.delete(target.id);
    outingAutoConfirmedZoneId=target.id;
    appStorage.setItem(OUTING_ID_KEY,data.id);
    saveOutingOrigin(data.id,target);
    saveZoneConfirmations();
    if(oldId!==data.id||!Number(appStorage.getItem(OUTING_INSTALLED_AT_KEY)||0)){
      appStorage.setItem(OUTING_INSTALLED_AT_KEY,String(Date.now()));
    }
    await populateZones(target.id);
    owner.check();
    if(activeSecret()!==data.secret||activeZone()?.id!==target.id){
      throw new Error("La session ou la zone a changé pendant l'installation. Vérifie l'état actif.");
    }
    clearExchangeInputsForNewOuting();
    refreshZoneConfirmationUi();
    refreshEncodeState();refreshDecodeState();refreshOutingActions();
    return"Sortie installée : session et alias de zone confirmés.";
  });
}

function renderOutingBoundsPreview(zone=null){
  const preview=$("outingBoundsPreview");
  const selected=zone||(outingZoneType==="builtin"
    ?BUILTIN_ZONES.find(z=>z.id===$("outingBuiltinSelect").value):null);
  if(!selected){
    preview.innerHTML="";
    preview.classList.add("hidden");
    return;
  }
  preview.innerHTML=zoneBoundsCompass(selected)+
    (isAnchoredZone(selected)
      ?`<p class="small">Centre virtuel de cette nouvelle session : ne pas transmettre à la VHF.</p>`
      :`<p class="small">Aperçu de la zone choisie ; elle n’est pas encore activée.</p>`);
  preview.classList.remove("hidden");
}

function outingSetupChanged(){
  outingSetupRevision++;
  outingCheckBusy=false;
  $("checkOutingCreate").disabled=outingZoneType==="builtin"&&!$("outingBuiltinSelect").value;
  pendingOutingCreation=null;
  $("outingCreateSummary").classList.add("hidden");
  $("confirmOutingCreate").classList.add("hidden");
  $("checkOutingCreate").classList.remove("hidden");
  hideStatus("outingCreateError");
  renderOutingBoundsPreview();
}

function setOutingZoneType(type){
  outingZoneType=type;
  $("outingBuiltinFields").classList.toggle("hidden",type!=="builtin");
  $("outingEphemeralFields").classList.toggle("hidden",type!=="ephemeral");
  $("outingBuiltinChoice").classList.toggle("active",type==="builtin");
  $("outingEphemeralChoice").classList.toggle("active",type==="ephemeral");
  outingSetupChanged();
}

function readOutingReferencePosition(){
  if(outingPositionMode==="marine"){
    const lat=parseDdmAxis("outingLatDeg","outingLatMin","outingLatHem",true);
    const lon=parseDdmAxis("outingLonDeg","outingLonMin","outingLonHem",false);
    if(!lat.ok)return{ok:false,error:lat.error};
    if(!lon.ok)return{ok:false,error:lon.error};
    return{ok:true,lat:lat.value,lon:lon.value};
  }
  const lat=parseNum($("outingLat").value),lon=parseNum($("outingLon").value);
  if(!Number.isFinite(lat)||lat<-89||lat>89||!Number.isFinite(lon)||lon<-180||lon>180){
    return{ok:false,error:"Position de référence invalide : latitude -89 à 89, longitude -180 à 180."};
  }
  return{ok:true,lat,lon};
}

function setOutingReferencePosition(lat,lon){
  const a=decimalAxisToDdm(lat,true),b=decimalAxisToDdm(lon,false);
  if(!a||!b)return;
  $("outingLat").value=String(lat);
  $("outingLon").value=String(lon);
  $("outingLatDeg").value=String(a.deg);
  $("outingLatMin").value=a.min.toFixed(3);
  $("outingLatHem").value=a.hem;
  $("outingLonDeg").value=String(b.deg);
  $("outingLonMin").value=b.min.toFixed(3);
  $("outingLonHem").value=b.hem;
  outingSetupChanged();
}

function setOutingPositionMode(mode){
  const current=readOutingReferencePosition();
  if(current.ok)setOutingReferencePosition(current.lat,current.lon);
  outingPositionMode=mode;
  $("outingMarineFields").classList.toggle("hidden",mode!=="marine");
  $("outingDecimalFields").classList.toggle("hidden",mode!=="decimal");
  $("outingMarineMode").classList.toggle("active",mode==="marine");
  $("outingDecimalMode").classList.toggle("active",mode==="decimal");
  outingSetupChanged();
}

function populateOutingBuiltinSelect(){
  const select=$("outingBuiltinSelect");
  select.innerHTML="";
  const placeholder=document.createElement("option");
  placeholder.value="";
  placeholder.textContent="Choisir une zone intégrée";
  placeholder.disabled=true;
  select.appendChild(placeholder);
  for(const z of [...BUILTIN_ZONES].sort((a,b)=>
    a.region.localeCompare(b.region,"fr")||compareZoneNames(a,b))){
    const option=document.createElement("option");
    option.value=z.id;
    option.textContent=z.region+" · "+z.name;
    select.appendChild(option);
  }
  select.value="";
}

function openOutingSetup(){
  if(outingMutationBusy)return;
  populateOutingBuiltinSelect();
  for(const id of ["outingLatDeg","outingLatMin","outingLonDeg","outingLonMin","outingLat","outingLon"])$(id).value="";
  $("outingLatHem").value="N";
  $("outingLonHem").value="W";
  outingPositionMode="marine";
  $("outingMarineFields").classList.remove("hidden");
  $("outingDecimalFields").classList.add("hidden");
  $("outingMarineMode").classList.add("active");
  $("outingDecimalMode").classList.remove("active");
  hideStatus("outingGpsStatus");
  setOutingZoneType("builtin");
  $("outingCreateDialog").showModal();
}

function appendOutingReview(label,value){
  const row=document.createElement("div"),heading=document.createElement("strong"),content=document.createElement("span");
  heading.textContent=label;
  content.textContent=value;
  row.append(heading,content);
  $("outingCreateSummary").appendChild(row);
}

async function reviewOutingSetup(){
  if(outingCheckBusy||outingMutationBusy)return;
  const revision=++outingSetupRevision,sessionRevision=activeSessionRevision,zoneId=activeZoneId;
  pendingOutingCreation=null;
  $("outingCreateSummary").classList.add("hidden");
  $("confirmOutingCreate").classList.add("hidden");
  hideStatus("outingCreateError");
  renderOutingBoundsPreview();
  outingCheckBusy=true;
  $("checkOutingCreate").disabled=true;
  try{
    assertProtocolReady();
    const secret=generateSessionSecret(),createdAt=Date.now(),id=randomOutingId();
    let candidate,position=null;
    if(outingZoneType==="builtin"){
      candidate=BUILTIN_ZONES.find(z=>z.id===$("outingBuiltinSelect").value);
      if(!candidate)throw new Error("Choisis une zone intégrée du catalogue.");
    }else{
      position=readOutingReferencePosition();
      if(!position.ok)throw new Error(position.error);
      const picked=await createEphemeralZoneCandidate(position.lat,position.lon,secret);
      candidate={...picked.z,id:"outing-preview",name:OUTING_EPHEMERAL_NAME,
        builtin:false,ephemeral:true,protocolId:PROTOCOL_ID};
    }
    const [fingerprint,alias]=await Promise.all([sessionFingerprint(secret),zoneAlias(secret,candidate)]);
    if(revision!==outingSetupRevision||!$("outingCreateDialog").open)return;
    if(sessionRevision!==activeSessionRevision||zoneId!==activeZoneId){
      throw new Error("La session ou la zone active a changé pendant la vérification. Recommence.");
    }
    const summary=$("outingCreateSummary");
    summary.innerHTML="";
    appendOutingReview("Zone choisie",candidate.name);
    if(position)appendOutingReview("Position de référence",formatDegMin(position.lat,true)+" / "+formatDegMin(position.lon,false));
    if(position)appendOutingReview("Ancre publique",candidate.anchorLat.toFixed(2)+" / "+candidate.anchorLon.toFixed(2));
    appendOutingReview("Nouvelle empreinte radio",fingerprint.words.join(" · ")+" | "+fingerprint.nato);
    appendOutingReview("Nouvel alias de zone",alias.text);
    appendOutingReview("Compatibilité",protocolShortLabel()+" · COMPAT "+(await protocolCompatDigestHex()).slice(0,8));
    if(revision!==outingSetupRevision||!$("outingCreateDialog").open)return;
    pendingOutingCreation={revision,sessionRevision,zoneId,secret,createdAt,id,candidate,position};
    renderOutingBoundsPreview(candidate);
    summary.classList.remove("hidden");
    $("checkOutingCreate").classList.add("hidden");
    $("confirmOutingCreate").classList.remove("hidden");
  }catch(e){
    if(revision===outingSetupRevision)setStatus("outingCreateError",e.message||String(e),"bad");
  }finally{
    if(revision===outingSetupRevision){
      outingCheckBusy=false;
      $("checkOutingCreate").disabled=false;
    }
  }
}

function lockOutingSetup(locked){
  for(const id of ["outingBuiltinChoice","outingEphemeralChoice","outingBuiltinSelect",
    "outingMarineMode","outingDecimalMode","outingLatDeg","outingLatMin","outingLatHem",
    "outingLonDeg","outingLonMin","outingLonHem","outingLat","outingLon","outingGpsBtn",
    "checkOutingCreate","confirmOutingCreate","cancelOutingCreate"]){
    $(id).disabled=locked;
  }
}

async function commitOutingSetup(){
  const draft=pendingOutingCreation;
  if(!draft||outingMutationBusy)return;
  if(draft.revision!==outingSetupRevision||draft.sessionRevision!==activeSessionRevision||draft.zoneId!==activeZoneId){
    outingSetupChanged();
    setStatus("outingCreateError","La préparation a changé. Vérifie de nouveau avant d'activer la sortie.","bad");
    return;
  }
  const action=++outingActionRevision;
  outingMutationBusy=true;
  lockOutingSetup(true);
  refreshOutingActions();
  try{
    const target=await withOutingRollback(async owner=>{
      const installing=installValidatedSecret(draft.secret,true,draft.createdAt);
      owner.capture();
      const installed=await installing;
      owner.check();
      if(!installed||action!==outingActionRevision||activeSecret()!==draft.secret){
        throw new Error("La session a changé pendant la création. Vérifie l'état actif.");
      }
      let target=draft.candidate;
      if(draft.position){
        target={...target,id:"eph-"+Date.now()+"-"+secureRandomIndex(1000000),
          createdAt:Date.now(),outingId:draft.id};
        zones.push(target);
        saveZones();
      }
      try{setActiveZone(target.id,{invalidate:true,persist:true,refresh:false});}
      finally{owner.capture();}
      confirmedZoneIds.add(target.id);
      manualConfirmedZoneIds.delete(target.id);
      outingAutoConfirmedZoneId=target.id;
      appStorage.setItem(OUTING_ID_KEY,draft.id);
      saveOutingOrigin(draft.id,target);
      saveZoneConfirmations();
      appStorage.setItem(OUTING_INSTALLED_AT_KEY,String(Date.now()));
      await populateZones(target.id);
      owner.check();
      if(activeSecret()!==draft.secret||activeZone()?.id!==target.id){
        throw new Error("La session ou la zone a changé pendant la création. Vérifie l'état actif.");
      }
      clearExchangeInputsForNewOuting();
      refreshZoneConfirmationUi();refreshEncodeState();refreshDecodeState();refreshOutingActions();
      // Dernière opération : après validation locale complète, activer durablement la sortie.
      await persistPreparedOuting();
      return target;
    });
    $("outingCreateDialog").close();
    showOutingSuccessDialog(`Sortie créée et active · ${target.name}.`);
  }catch(e){setStatus("outingCreateError",e.message||String(e),"bad");}
  finally{
    outingMutationBusy=false;
    lockOutingSetup(false);
    refreshOutingActions();
  }
}

$("outingBuiltinChoice").onclick=()=>setOutingZoneType("builtin");
$("outingEphemeralChoice").onclick=()=>setOutingZoneType("ephemeral");
$("outingBuiltinSelect").onchange=outingSetupChanged;
$("outingMarineMode").onclick=()=>setOutingPositionMode("marine");
$("outingDecimalMode").onclick=()=>setOutingPositionMode("decimal");
for(const id of ["outingLatDeg","outingLatMin","outingLonDeg","outingLonMin","outingLat","outingLon",
  "outingLatHem","outingLonHem"]){
  $(id).addEventListener(id.endsWith("Hem")?"change":"input",outingSetupChanged);
}
$("outingGpsBtn").onclick=()=>{
  if(!navigator.geolocation){
    setStatus("outingGpsStatus","GPS indisponible : saisis la position de référence.","bad");
    return;
  }
  const revision=++outingSetupRevision;
  pendingOutingCreation=null;
  $("outingCreateSummary").classList.add("hidden");
  $("confirmOutingCreate").classList.add("hidden");
  setStatus("outingGpsStatus","Recherche de la position GPS de référence…","warn gps-searching");
  navigator.geolocation.getCurrentPosition(
    fix=>{
      if(revision!==outingSetupRevision||!$("outingCreateDialog").open||outingMutationBusy)return;
      const lat=Number(fix.coords.latitude),lon=Number(fix.coords.longitude);
      if(!Number.isFinite(lat)||lat<-89||lat>89||!Number.isFinite(lon)||lon<-180||lon>180){
        setStatus("outingGpsStatus","Position GPS invalide. Saisis-la manuellement.","bad");return;
      }
      setOutingReferencePosition(lat,lon);
      const accuracy=Number(fix.coords.accuracy);
      setStatus("outingGpsStatus",Number.isFinite(accuracy)&&accuracy>100
        ?"GPS récupéré, précision annoncée ±"+Math.round(accuracy)+" m. Vérifie la position."
        :"Position GPS récupérée. Vérifie-la avant de créer la sortie.",
        accuracy>100?"warn":"ok");
    },
    error=>{
      if(revision===outingSetupRevision&&$("outingCreateDialog").open)
        setStatus("outingGpsStatus","GPS : "+(error.message||"acquisition impossible"),"bad");
    },
    {enableHighAccuracy:true,timeout:60000,maximumAge:0}
  );
};
$("checkOutingCreate").onclick=reviewOutingSetup;
$("confirmOutingCreate").onclick=commitOutingSetup;
$("cancelOutingCreate").onclick=()=>{if(!outingMutationBusy)$("outingCreateDialog").close();};
$("outingCreateDialog").addEventListener("cancel",event=>{if(outingMutationBusy)event.preventDefault();});
$("outingCreateDialog").addEventListener("close",()=>{
  outingSetupRevision++;
  outingCheckBusy=false;
  $("checkOutingCreate").disabled=outingZoneType==="builtin"&&!$("outingBuiltinSelect").value;
  pendingOutingCreation=null;
  hideStatus("outingCreateError");
  $("outingBoundsPreview").innerHTML="";
  $("outingBoundsPreview").classList.add("hidden");
});
async function openOutingShare(){
  if(outingCopyBusy||outingMutationBusy)return;
  clearOutingShare();
  $("outingShareDialog").showModal();
  const revision=outingShareRevision,secret=activeSecret(),zoneId=activeZone()?.id,sessionRevision=activeSessionRevision;
  outingCopyBusy=true;refreshOutingActions();
  setStatus("outingShareStatus","Préparation de l'invitation…","warn");
  try{
    const payload=await activeOutingPayload();
    const invitation=await formatOutingInvitation(payload);
    if(revision!==outingShareRevision||!$("outingShareDialog").open)return;
    if(activeSecret()!==secret||activeZone()?.id!==zoneId||activeSessionRevision!==sessionRevision||
        appStorage.getItem(OUTING_ID_KEY)!==payload.id||!outingMatchesOriginalZone(activeZone())||
        !isZoneConfirmed(activeZone())){
      throw new Error("La session ou la zone a changé. Ferme cette fenêtre et recommence.");
    }
    outingShareReady={text:invitation,secret,zoneId,sessionRevision,outingId:payload.id};
    $("outingShareText").value=invitation;
    refreshOutingShareControls();
    hideStatus("outingShareStatus");
  }catch(e){
    if(revision===outingShareRevision&&$("outingShareDialog").open){
      setStatus("outingShareStatus",e.message||String(e),"bad");
    }
  }finally{
    if(revision===outingShareRevision){
      outingCopyBusy=false;
      refreshOutingShareControls();
      refreshOutingActions();
    }
  }
}

$("copyOutingMessageBtn").onclick=async()=>{
  const draft=outingShareReady,revision=outingShareRevision;
  if(!draft||outingCopyBusy||!$("outingShareDialog").open)return;
  if(activeSecret()!==draft.secret||activeZone()?.id!==draft.zoneId||
      activeSessionRevision!==draft.sessionRevision||appStorage.getItem(OUTING_ID_KEY)!==draft.outingId||
      !outingMatchesOriginalZone(activeZone())||!isZoneConfirmed(activeZone())){
    clearOutingShare();
    return;
  }
  outingCopyBusy=true;refreshOutingActions();
  refreshOutingShareControls();
  try{
    if(!navigator.clipboard?.writeText)throw new Error("Presse-papiers indisponible");
    await navigator.clipboard.writeText(draft.text);
    if(revision!==outingShareRevision||!$("outingShareDialog").open)return;
    if(activeSecret()!==draft.secret||activeZone()?.id!==draft.zoneId||
        activeSessionRevision!==draft.sessionRevision||appStorage.getItem(OUTING_ID_KEY)!==draft.outingId||
        !outingMatchesOriginalZone(activeZone())||!isZoneConfirmed(activeZone())){
      clearOutingShare();
      return;
    }
    setStatus("outingShareStatus","Invitation copiée. Envoie le message tel quel aux participants.","ok");
  }catch{
    if(revision===outingShareRevision&&$("outingShareDialog").open){
      $("outingShareText").focus({preventScroll:true});
      $("outingShareText").select();
      setStatus("outingShareStatus","Invitation sélectionnée : copie-la manuellement, puis envoie-la telle quelle.","warn");
    }
  }finally{
    if(revision===outingShareRevision){
      outingCopyBusy=false;
      refreshOutingShareControls();
      refreshOutingActions();
    }
  }
};
$("nativeShareOutingBtn").onclick=async()=>{
  const draft=outingShareReady,revision=outingShareRevision;
  if(!draft||outingCopyBusy||!$("outingShareDialog").open||!canShareOutingText(draft.text))return;
  if(activeSecret()!==draft.secret||activeZone()?.id!==draft.zoneId||
      activeSessionRevision!==draft.sessionRevision||appStorage.getItem(OUTING_ID_KEY)!==draft.outingId||
      !outingMatchesOriginalZone(activeZone())||!isZoneConfirmed(activeZone())){
    clearOutingShare();
    return;
  }
  outingCopyBusy=true;refreshOutingActions();refreshOutingShareControls();
  try{
    // L'appel doit rester dans le clic utilisateur pour ouvrir le partage natif.
    await navigator.share({text:draft.text});
    if(revision!==outingShareRevision||!$("outingShareDialog").open)return;
    setStatus("outingShareStatus","Partage lancé. Vérifie le destinataire et l’envoi dans l’application choisie.","ok");
  }catch(e){
    if(revision===outingShareRevision&&$("outingShareDialog").open){
      setStatus("outingShareStatus",e?.name==="AbortError"
        ?"Partage annulé. Le message reste disponible à copier."
        :"Partage indisponible. Copie le message puis colle-le dans l’application de ton choix.","warn");
    }
  }finally{
    if(revision===outingShareRevision){
      outingCopyBusy=false;
      refreshOutingShareControls();
      refreshOutingActions();
    }
  }
};
$("shareOutingBtn").onclick=openOutingShare;
$("closeOutingShare").onclick=()=>$("outingShareDialog").close();
$("outingShareDialog").addEventListener("close",()=>{clearOutingShare();refreshOutingActions();});

function invalidateOutingImportReview(){
  outingImportRevision++;
  pendingOutingImport=null;
  $("confirmOutingImport").classList.add("hidden");
  $("outingImportSummary").classList.add("hidden");
  $("outingImportVerified").classList.add("hidden");
  hideStatus("outingImportWarning");
  hideStatus("outingImportDialogError");
}

async function prepareOutingImport(content){
  if(outingMutationBusy||!$("outingImportDialog").open)return;
  invalidateOutingImportReview();
  const revision=outingImportRevision;
  try{
    const prepared=await inspectOutingInvitation(content);
    if(revision!==outingImportRevision||!$("outingImportDialog").open)return;
    pendingOutingImport={...prepared,sessionRevision:activeSessionRevision,zoneId:activeZoneId};
    showOutingImportSummary(prepared);
    $("confirmOutingImport").classList.remove("hidden");
  }catch(e){
    if(revision===outingImportRevision&&$("outingImportDialog").open){
      setStatus("outingImportDialogError",e.message||String(e),"bad");
    }
  }
}
$("cancelOutingImport").onclick=()=>{if(!outingMutationBusy)$("outingImportDialog").close();};
$("outingImportDialog").addEventListener("cancel",event=>{if(outingMutationBusy)event.preventDefault();});
$("outingImportDialog").addEventListener("close",()=>{
  invalidateOutingImportReview();
});
$("confirmOutingImport").onclick=async()=>{
  const prepared=pendingOutingImport,dialog=$("outingImportDialog");
  if(!prepared||outingMutationBusy||!dialog.open)return;
  if(activeSessionRevision!==prepared.sessionRevision||activeZoneId!==prepared.zoneId){
    invalidateOutingImportReview();
    setStatus("outingImportDialogError","La session ou la zone active a changé. Annule puis reçois l'invitation de nouveau depuis l'accueil.","bad");
    return;
  }
  outingMutationBusy=true;refreshOutingActions();
  for(const id of ["confirmOutingImport","cancelOutingImport"])$(id).disabled=true;
  try{
    await installOutingInvitation(prepared);
    await persistPreparedOuting();
    dialog.close();
    showOutingSuccessDialog(`Sortie activée. Zone active : ${activeZone()?.name||"—"}.`);
  }catch(e){
    invalidateOutingImportReview();
    setStatus("outingImportDialogError",e.message||String(e),"bad");
  }finally{
    for(const id of ["confirmOutingImport","cancelOutingImport"])$(id).disabled=false;
    outingMutationBusy=false;refreshOutingActions();
  }
};
refreshOutingActions();

$("protocolSelfTestBtn").onclick=runProtocolSelfTest;

// Navigation / GPS / zones
$("tabSend").onclick=()=>{$("sendPanel").classList.remove("hidden");$("receivePanel").classList.add("hidden");$("tabSend").classList.add("active");$("tabReceive").classList.remove("active");};
$("tabReceive").onclick=()=>{$("sendPanel").classList.add("hidden");$("receivePanel").classList.remove("hidden");$("tabSend").classList.remove("active");$("tabReceive").classList.add("active");};
sendZone.onchange=async()=>{
  const targetId=sendZone.value;
  syncZoneSelects();
  try{await switchToExistingZone(targetId,{clearPosition:true});}
  catch(e){setStatus("sendZoneActionStatus",e.message||String(e),"bad");}
};
recvZone.onchange=async()=>{
  const targetId=recvZone.value;
  syncZoneSelects();
  try{await switchToExistingZone(targetId,{clearPosition:true});}
  catch(e){setStatus("recvZoneActionStatus",e.message||String(e),"bad");}
};

$("positionModeMarine").onclick=()=>setPositionInputMode("marine");
$("positionModeDecimal").onclick=()=>setPositionInputMode("decimal");

$("zoneCenterModeMarine").onclick=()=>setZoneCenterInputMode("marine");
$("zoneCenterModeDecimal").onclick=()=>setZoneCenterInputMode("decimal");

for(const id of ["zoneLatDeg","zoneLatMin","zoneLonDeg","zoneLonMin","zoneLatHem","zoneLonHem"]){
  $(id).addEventListener(id.endsWith("Hem")?"change":"input",syncZoneCenterFromMarine);
}
for(const id of ["zoneLat","zoneLon"]){
  $(id).addEventListener("input",syncZoneCenterFromDecimal);
}

for(const id of ["latDeg","latMin","lonDeg","lonMin","latHem","lonHem"]){
  $(id).addEventListener(id.endsWith("Hem")?"change":"input",syncPositionFromMarine);
}

for(const id of ["lat","lon"]){
  $(id).addEventListener("input",syncPositionFromDecimal);
}

$("gpsBtn").onclick=()=>{
  if(!navigator.geolocation)return setDriftStatus("GPS navigateur indisponible.","bad");
  const revision=++senderGpsRevision,sessionRevision=activeSessionRevision;
  setDriftStatus("Recherche de ta position GPS…","warn gps-searching");
  navigator.geolocation.getCurrentPosition(
    p=>{
      if(revision!==senderGpsRevision||sessionRevision!==activeSessionRevision)return;
      const lat=Number(p.coords.latitude),lon=Number(p.coords.longitude);
      if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
        setDriftStatus("Position GPS invalide : recopie celle du sondeur ou du traceur.","bad");
        return;
      }
      setDecimalPosition(lat,lon,{updateMarine:true});
      handlePositionChanged();
      const accuracy=Number(p.coords.accuracy);
      if(Number.isFinite(accuracy)&&accuracy>100){
        setDriftStatus(`GPS récupéré, mais précision annoncée ±${Math.round(accuracy)} m. Vérifie avant transmission.`,"warn");
      }
    },
    e=>{
      if(revision===senderGpsRevision&&sessionRevision===activeSessionRevision)setDriftStatus("GPS : "+e.message,"bad");
    },
    {enableHighAccuracy:true,timeout:60000,maximumAge:0}
  );
};
$("centerGpsBtn").onclick=()=>{
  if(!navigator.geolocation)return setStatus("zoneStatus","GPS navigateur indisponible.","bad");
  const revision=++centerGpsRevision;
  setStatus("zoneStatus","Recherche de la position GPS du centre…","warn gps-searching");
  navigator.geolocation.getCurrentPosition(
    p=>{
      if(revision!==centerGpsRevision)return;
      const lat=Number(p.coords.latitude),lon=Number(p.coords.longitude);
      if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
        setStatus("zoneStatus","Position GPS invalide : saisis le centre manuellement.","bad");
        return;
      }
      setZoneCenterDecimal(lat,lon,{updateMarine:true});
      const accuracy=Number(p.coords.accuracy);
      setStatus(
        "zoneStatus",
        Number.isFinite(accuracy)&&accuracy>100
          ?`Centre GPS récupéré, précision annoncée ±${Math.round(accuracy)} m.`
          :"Centre GPS récupéré.",
        Number.isFinite(accuracy)&&accuracy>100?"warn":"ok"
      );
    },
    e=>{
      if(revision===centerGpsRevision)setStatus("zoneStatus","GPS : "+e.message,"bad");
    },
    {enableHighAccuracy:true,timeout:60000,maximumAge:0}
  );
};
$("saveZoneBtn").onclick=async()=>{
  try{
    const name=String($("zoneName").value??"").trim().toUpperCase();
    const p=readActiveZoneCenter();
    if(name.length<2)throw new Error("Nom de zone requis.");
    if(!p.ok)throw new Error(p.error);
    const lat=canonicalCoord(p.lat),lon=canonicalCoord(p.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error("Centre invalide.");
    const existing=zones.find(z=>!isAnchoredZone(z)&&sameZoneCenter(z,{lat,lon}));
    if(existing){
      if(existing.id===activeZoneId){
        setStatus("zoneStatus",`Ce centre existe déjà sous le libellé « ${existing.name} ». Cette zone est déjà active.`,"warn");
        return;
      }
      if(!await switchToExistingZone(existing.id))return;
      setStatus("zoneStatus",`Ce centre existe déjà sous le libellé « ${existing.name} ». Zone active sélectionnée.`,"warn");
      return;
    }
    if(!await confirmManualZoneChange(name,{creation:true,detail:`Centre : ${lat.toFixed(5)} / ${lon.toFixed(5)}.`}))return;
    if(zones.some(z=>!isAnchoredZone(z)&&sameZoneCenter(z,{lat,lon}))){
      throw new Error("Ce centre a été ajouté pendant la confirmation. Recommence.");
    }
    const current=readActiveZoneCenter();
    if(!current.ok||String($("zoneName").value??"").trim().toUpperCase()!==name||
       canonicalCoord(current.lat)!==lat||canonicalCoord(current.lon)!==lon){
      throw new Error("Le nom ou le centre a changé pendant la confirmation. Recommence.");
    }
    const id="z-"+Date.now();
    zones.push({id,name,lat,lon,builtin:false});
    saveZones();
    setActiveZone(id,{invalidate:true,persist:true,refresh:false});
    populateZones(id);
    setStatus("zoneStatus","Zone enregistrée. Son alias radio dépend du centre canonique et du secret, pas du libellé.","ok");
  }catch(e){setStatus("zoneStatus",e.message,"bad");}
};

$("addReceivedZoneBtn").onclick=async()=>{
  const button=$("addReceivedZoneBtn");
  if(button.disabled)return;
  button.disabled=true;
  hideStatus("receivedZoneStatus");
  try{
    const secret=activeSecret(),sessionRevision=activeSessionRevision,deletionRevision=ephemeralDeletionRevision;
    if(!validateSessionSecret(secret).ok)throw new Error("Valide d’abord le secret de session pour reconstruire la zone.");
    const rawAnchorLat=parseNum($("receivedZoneLat").value),rawAnchorLon=parseNum($("receivedZoneLon").value);
    assertValidPublicAnchor(rawAnchorLat,rawAnchorLon);
    const anchorLat=canonicalAnchorCoord(rawAnchorLat),anchorLon=canonicalAnchorCoord(rawAnchorLon);
    const localName=ephemeralLocalLabel(String($("receivedZoneName").value??"").trim().toUpperCase()||"ZONE REÇUE");
    let z=zones.find(x=>isAnchoredZone(x)&&x.anchorLat===anchorLat&&x.anchorLon===anchorLon),created=!z;
    if(!z){
      const center=await deriveSecretCenter(secret,anchorLat,anchorLon);
      z={name:localName,lat:center.lat,lon:center.lon,anchorLat,anchorLon};
    }
    assertZoneSessionCurrent(secret,sessionRevision);
    assertEphemeralDeletionCurrent(deletionRevision);
    if(z.id===activeZoneId){
      setStatus("receivedZoneStatus","Cette zone éphémère est déjà active.","warn");
      return;
    }
    if(!await confirmManualZoneChange(z.name,{
      creation:created,
      detail:`Ancre publique : ${anchorLat.toFixed(2)} / ${anchorLon.toFixed(2)}.`
    }))return;
    assertZoneSessionCurrent(secret,sessionRevision);
    assertEphemeralDeletionCurrent(deletionRevision);
    if(canonicalAnchorCoord(parseNum($("receivedZoneLat").value))!==anchorLat||
       canonicalAnchorCoord(parseNum($("receivedZoneLon").value))!==anchorLon){
      throw new Error("L’ancre publique a changé pendant la confirmation. Recommence.");
    }
    if(!created&&!zones.includes(z))throw new Error("Cette zone n’est plus disponible. Recommence.");
    if(created)z=await saveOrSelectEphemeralZone(anchorLat,anchorLon,secret,localName,sessionRevision,deletionRevision);
    setActiveZone(z.id,{invalidate:true,persist:true,refresh:false});
    populateZones(z.id);
    refreshDecodeState();
    const alias=await zoneAlias(secret,z);
    if(activeSessionRevision!==sessionRevision || activeSecret()!==secret || activeZone()?.id!==z.id)return;
    receivedZoneNoticeContext={zoneId:z.id,secret};
    setStatus(
      "receivedZoneNotice",
      `${created?"Zone reconstruite":"Zone déjà connue"} sous « ${z.name} ». Vérifie maintenant que l’émetteur annonce exactement l’alias « ${alias.text} » avant de poursuivre.`,
      "warn"
    );
    refreshZoneConfirmationUi();
    for(const id of ["receivedZoneName","receivedZoneLat","receivedZoneLon"]){
      $(id).value="";
    }
    $("receivedZoneDetails").open=false;
    $("recvZoneConfirmBtn").focus({preventScroll:true});
    $("recvZoneConfirmBlock").scrollIntoView({block:"nearest"});
  }catch(e){
    $("receivedZoneDetails").open=true;
    setStatus("receivedZoneStatus",e.message||String(e),"bad");
  }finally{
    button.disabled=false;
  }
};


let pendingZoneDeletion=null;

function clearZoneDeletionNotice(){
  if(!zoneDeletionNotice)return;
  clearTimeout(zoneDeletionNotice.timer);
  for(const id of ["zoneStatus","sendZoneActionStatus","recvZoneActionStatus"]){
    const el=$(id);
    if(el.textContent===zoneDeletionNotice.message && el.className==="status ok")hideStatus(id);
  }
  zoneDeletionNotice=null;
}

function showZoneDeletionNotice(message){
  clearZoneDeletionNotice();
  const notice={message,timer:null};
  zoneDeletionNotice=notice;
  for(const id of ["zoneStatus","sendZoneActionStatus","recvZoneActionStatus"]){
    setStatus(id,message,"ok");
  }
  notice.timer=setTimeout(()=>{
    if(zoneDeletionNotice===notice)clearZoneDeletionNotice();
  },5000);
}

function requestZoneDeletion(id,focusId){
  const z=zones.find(x=>x.id===id);
  if(!z || z.builtin){
    setStatus("zoneStatus","Aucune zone personnalisée sélectionnée.","warn");
    return;
  }
  if(isOutingEphemeral(z)){
    setStatus("zoneStatus","Cette zone éphémère de sortie est conservée jusqu'à la prochaine session.","warn");
    return;
  }
  pendingZoneDeletion={kind:"single",id:z.id,focusId};
  $("zoneDeleteTitle").textContent="Supprimer cette zone ?";
  $("zoneDeleteName").textContent=z.name;
  $("zoneDeleteDescription").textContent=activeZoneId===z.id
    ?"Cette zone sera supprimée de cet appareil. Les résultats préparés pour cette zone seront effacés et une zone intégrée deviendra active."
    :"Cette zone sera supprimée de cet appareil. La zone active sera conservée.";
  hideStatus("zoneDeleteError");
  $("confirmZoneDelete").textContent="Supprimer la zone";
  $("zoneDeleteDialog").showModal();
  $("cancelZoneDelete").focus();
}

function requestEphemeralZonesDeletion(){
  const count=zones.filter(z=>z.ephemeral&&!isOutingEphemeral(z)).length;
  if(!count)return;
  pendingZoneDeletion={kind:"ephemeral-all",focusId:"manageZoneSelect"};
  $("zoneDeleteTitle").textContent="Supprimer toutes les zones éphémères ?";
  $("zoneDeleteName").textContent=`${count} zone${count>1?"s":""} éphémère${count>1?"s":""}`;
  const protectedNote=zones.some(isOutingEphemeral)?" La zone éphémère de sortie sera conservée.":"";
  $("zoneDeleteDescription").textContent=(zones.some(z=>z.ephemeral&&!isOutingEphemeral(z)&&z.id===activeZoneId)
    ?"Ces zones seront supprimées de cet appareil. Une zone intégrée deviendra active et son alias devra être reconfirmé."
    :"Ces zones seront supprimées de cet appareil. Les zones intégrées et personnalisées fixes seront conservées.")+protectedNote;
  hideStatus("zoneDeleteError");
  $("confirmZoneDelete").textContent="Supprimer les zones éphémères";
  $("zoneDeleteDialog").showModal();
  $("cancelZoneDelete").focus();
}

function deleteCustomZone(id){
  const z=zones.find(x=>x.id===id);
  if(!z)throw new Error("Cette zone n’existe plus.");
  if(z.builtin)throw new Error("Une zone intégrée ne peut pas être supprimée.");
  if(isOutingEphemeral(z))throw new Error("Cette zone éphémère de sortie est conservée jusqu'à la prochaine session.");
  confirmedZoneIds.delete(z.id);
  manualConfirmedZoneIds.delete(z.id);
  if(outingAutoConfirmedZoneId===z.id)outingAutoConfirmedZoneId=null;
  saveZoneConfirmations();
  const wasActive=activeZoneId===z.id;
  zones=zones.filter(x=>x.id!==z.id);
  saveZones();

  const fallback=wasActive
    ? (zones.find(x=>x.builtin)?.id || zones[0]?.id || "")
    : activeZoneId;

  if(fallback)setActiveZone(fallback,{invalidate:true,persist:true,refresh:false});
  populateZones(fallback);
  const message=`Zone « ${z.name} » supprimée.${wasActive?" Une zone intégrée est maintenant active.":""}`;
  showZoneDeletionNotice(message);
}

function deleteAllEphemeralZones(){
  const removed=zones.filter(z=>z.ephemeral&&!isOutingEphemeral(z));
  if(!removed.length)throw new Error("Aucune zone éphémère à supprimer.");
  ephemeralDeletionRevision++;
  const wasActive=removed.some(z=>z.id===activeZoneId);
  for(const z of removed){
    confirmedZoneIds.delete(z.id);
    manualConfirmedZoneIds.delete(z.id);
    if(outingAutoConfirmedZoneId===z.id)outingAutoConfirmedZoneId=null;
  }
  saveZoneConfirmations();
  zones=zones.filter(z=>!z.ephemeral||isOutingEphemeral(z));
  saveZones();

  const fallback=wasActive
    ?(zones.find(z=>z.builtin)?.id || zones[0]?.id || "")
    :activeZoneId;
  if(fallback)setActiveZone(fallback,{invalidate:true,persist:true,refresh:false});
  populateZones(fallback);
  showZoneDeletionNotice(`${removed.length} zone${removed.length>1?"s":""} éphémère${removed.length>1?"s":""} supprimée${removed.length>1?"s":""}.${wasActive?" Une zone intégrée est maintenant active.":""}`);
}

$("sendDeleteZoneBtn").onclick=()=>requestZoneDeletion(activeZoneId,"sendZone");
$("recvDeleteZoneBtn").onclick=()=>requestZoneDeletion(activeZoneId,"recvZone");
$("deleteZoneBtn").onclick=()=>requestZoneDeletion($("manageZoneSelect").value,"manageZoneSelect");
$("manageZoneSelect").onchange=updateManageZoneDeletionButton;
$("deleteEphemeralZonesBtn").onclick=requestEphemeralZonesDeletion;
$("cancelZoneDelete").onclick=()=>$("zoneDeleteDialog").close();
$("zoneDeleteDialog").addEventListener("close",()=>{
  const focusId=pendingZoneDeletion?.focusId;
  pendingZoneDeletion=null;
  if(focusId)$(focusId).focus({preventScroll:true});
});
$("confirmZoneDelete").onclick=()=>{
  if(!pendingZoneDeletion)return;
  try{
    if(pendingZoneDeletion.kind==="ephemeral-all")deleteAllEphemeralZones();
    else deleteCustomZone(pendingZoneDeletion.id);
    $("zoneDeleteDialog").close();
  }catch(e){
    setStatus("zoneDeleteError",e.message||String(e),"bad");
  }
};
setActiveZone(activeZoneId,{refresh:false});
populateZones();
initPositionInputUi();
initZoneCenterInputUi();

