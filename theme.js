/* Color themes. Each person's pick is saved on their own device (localStorage).
   bg / panel / accent below are only for the little preview chips; the real colours are the CSS variables above. */
const THEMES = {
  green:  { label:'Green',  bg:'#14261F', panel:'#1B3129', accent:'#D9B65B' },
  blue:   { label:'Blue',   bg:'#0F1B2D', panel:'#16263E', accent:'#6FB1F2' },
  purple: { label:'Purple', bg:'#1B1428', panel:'#251B38', accent:'#C39BF0' },
  red:    { label:'Red',    bg:'#241214', panel:'#301A1D', accent:'#F08A7C' },
  orange: { label:'Orange', bg:'#241A0E', panel:'#2F2213', accent:'#F2A93B' },
  dark:   { label:'Dark',   bg:'#0E0F11', panel:'#1A1D21', accent:'#56C7D6' },
  light:  { label:'Light',  bg:'#F2F4F3', panel:'#FFFFFF', accent:'#1F6B4A' }
};
const THEME_KEY = 'pos-theme';
function currentTheme(){
  try{ const t = localStorage.getItem(THEME_KEY); if(t && THEMES[t]) return t; }catch(e){}
  return 'green';
}
function applyTheme(name, save){
  if(!THEMES[name]) name = 'green';
  document.documentElement.setAttribute('data-theme', name);
  const m = document.querySelector('meta[name="theme-color"]');
  if(m) m.setAttribute('content', THEMES[name].bg);
  if(save){ try{ localStorage.setItem(THEME_KEY, name); }catch(e){} }
  document.querySelectorAll('.theme-opt').forEach(b=> b.classList.toggle('active', b.dataset.themePick === name));
}
applyTheme(currentTheme(), false);
