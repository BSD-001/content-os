// 前后端共用卡通风格清单；一篇内统一，新稿自动轮换。
export const cartoonStyles = [
  { id:'cartoon-notebook-v1', name:'奶油手帐卡通风', background:'#FFF6E5', accents:['#C6E8DB','#FFD6B8','#D8D5F0'], outline:'#2E3D3A' },
  { id:'cartoon-comic-v1', name:'清爽漫画分镜风', background:'#F2FAFF', accents:['#9DDDFF','#FFBDD6','#FFE48C'], outline:'#21314D' },
  { id:'cartoon-sticker-v1', name:'彩色贴纸拼贴风', background:'#F2FFF6', accents:['#BDEBCD','#DCD2FF','#FFE5A5'], outline:'#37433E' }
];
export const isCartoonStyle = id => cartoonStyles.some(style => style.id === id);
export function nextCartoonStyleId(previousId) {
  return cartoonStyles[(cartoonStyles.findIndex(style => style.id === previousId) + 1) % cartoonStyles.length].id;
}
