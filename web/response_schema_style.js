// Kept inside the editor's shadow root; never changes other nodes or page controls.
export const EDITOR_CSS = `
:host { display:block; width:100%; height:100%; min-width:0; min-height:0; color:var(--input-text,#ddd); font:12px/1.3 sans-serif; }
*, *::before, *::after { box-sizing:border-box; }
.editor { width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; padding:4px; scrollbar-width:thin; }
.content { min-width:0; }
.entry { min-width:0; border:1px solid var(--border-color,#50545c); border-radius:3px; padding:3px; background:var(--comfy-menu-bg,#24272d); margin:0 0 4px; }
.entry:last-child { margin-bottom:0; }
.entry-header { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:0 0 3px; border-bottom:1px solid var(--border-color,#50545c); }
.entry-title { font-size:12px; font-weight:600; margin-right:auto; overflow-wrap:anywhere; min-width:0; }
.entry-body { display:flex; flex-direction:column; gap:4px; padding-top:3px; min-width:0; }
.entry-body[hidden] { display:none; }
.collapse-entry { margin-left:auto; }
.control { display:flex; align-items:center; gap:4px; min-width:0; margin:0; }
.caption { flex:0 0 auto; }
.name { flex:1 1 100px; }
.name input { width:100%; min-width:50px; }
.description { align-items:flex-start; }
.description .caption { padding-top:3px; width:76px; white-space:normal; }
.description.single-line { align-items:center; }
.description.single-line .caption { padding-top:0; width:auto; }
.description.single-line input { flex:1 1 0; width:100%; }
.check { flex:0 0 auto; cursor:pointer; }
input, select, textarea, button { color:var(--input-text,#ddd); background:var(--comfy-input-bg,#30343b); border:1px solid var(--border-color,#555b64); border-radius:3px; font:inherit; padding:2px 4px; margin:0; min-width:0; max-width:100%; }
input, select, button { min-height:24px; }
select, button { width:auto; flex:0 1 auto; cursor:pointer; }
input[type=checkbox] { width:14px; height:14px; min-height:0; padding:0; flex:0 0 14px; accent-color:#80a9d0; }
input[type=number] { width:80px; }
textarea { display:block; flex:1 1 0; width:100%; min-height:36px; resize:vertical; line-height:1.3; }
input:focus-visible, select:focus-visible, textarea:focus-visible { outline:1px solid #8dbbea; outline-offset:1px; }
.children { min-width:0; padding-left:3px; border-left:1px solid var(--border-color,#50545c); }
.add-field { padding:1px 0; }
.bounds { display:flex; flex-wrap:wrap; gap:4px 8px; min-width:0; }
.bound { display:flex; flex-wrap:wrap; gap:4px; min-width:0; }
.error { color:#ffb2b2; border:1px solid #925454; border-radius:3px; padding:4px; white-space:normal; overflow-wrap:anywhere; }
`;
