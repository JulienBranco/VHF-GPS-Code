export const VIEW_KEY="vhfgps-main-view-v1";
export function showLoading(){document.documentElement.classList.add("app-loading");}
export function showPage(){document.documentElement.classList.remove("app-loading");}
export function rememberView(id){sessionStorage.setItem(VIEW_KEY,JSON.stringify({id,scroll:window.scrollY,theme:document.documentElement.dataset.theme}));}
export function applyLoadingTheme(){try{const view=JSON.parse(sessionStorage.getItem(VIEW_KEY)||"null");if(view?.theme==="day"||view?.theme==="night")document.documentElement.dataset.theme=view.theme;}catch{sessionStorage.removeItem(VIEW_KEY);}}
export function restoreView(id){
 const raw=sessionStorage.getItem(VIEW_KEY);sessionStorage.removeItem(VIEW_KEY);if(!raw)return;
 try{const view=JSON.parse(raw);if(view.id===id&&Number.isFinite(view.scroll)&&view.scroll>=0)window.scrollTo({top:view.scroll,behavior:"instant"});}catch{}
}
