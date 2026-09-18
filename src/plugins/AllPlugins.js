import { ImageEditorPlugin } from './image/ImageEditor.js';
import { ImageToolsPlugin } from './image/ImageTools.js';
import { VideoEditorPlugin } from './video/VideoEditor.js';
import { VideoEffectsPlugin } from './video/VideoEffects.js';
import { AudioEditorPlugin } from './audio/AudioEditor.js';
import { AudioEffectsPlugin } from './audio/AudioEffects.js';
import { PDFEditorPlugin } from './pdf/PDFEditor.js';
import { ArchiveExplorerPlugin } from './archive/ArchiveExplorer.js';
import { TextEditorPlugin } from './text/TextEditor.js';
import { ModelViewerPlugin } from './model/ModelViewer.js';

export function registerAllPlugins(registry) {
  const registrations = [
    { type: 'IMAGE', plugin: ImageEditorPlugin },
    { type: 'IMAGE_TOOLS', plugin: ImageToolsPlugin },
    { type: 'VIDEO', plugin: VideoEditorPlugin },
    { type: 'VIDEO_EFFECTS', plugin: VideoEffectsPlugin },
    { type: 'AUDIO', plugin: AudioEditorPlugin },
    { type: 'AUDIO_EFFECTS', plugin: AudioEffectsPlugin },
    { type: 'PDF', plugin: PDFEditorPlugin },
    { type: 'ARCHIVE', plugin: ArchiveExplorerPlugin },
    { type: 'TEXT', plugin: TextEditorPlugin },
    { type: 'MODEL', plugin: ModelViewerPlugin },
  ];

  for (const { type, plugin } of registrations) {
    registry.register(type, plugin, {
      version: plugin.version || '1.0.0',
      priority: plugin.priority || 0,
      description: plugin.name,
    });
  }

  registry.register('BINARY', {
    type: 'BINARY',
    name: 'Hex Viewer',
    version: '1.0.0',
    async init(surface, tools, file) {
      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:10px;font-family:monospace;font-size:12px;overflow:hidden;background:#0a0a0a;">
          <div id="hex-content" style="flex:1;overflow:auto;white-space:pre;line-height:1.5;background:#0a0a0a;border:1px solid #222;border-radius:3px;padding:8px;"></div>
        </div>
      `;
      tools.innerHTML = '<p style="font-size:10px;color:#666;text-align:center;">Binary preview</p>';
      const content = document.getElementById('hex-content');
      const buffer = await file.blob.slice(0, 16384).arrayBuffer();
      const data = new Uint8Array(buffer);
      let html = '';
      for (let i = 0; i < data.length; i += 16) {
        const offset = i.toString(16).padStart(8, '0').toUpperCase();
        let hex = '';
        let ascii = '';
        for (let j = 0; j < 16; j++) {
          if (i + j < data.length) {
            const b = data[i + j];
            hex += b.toString(16).padStart(2, '0').toUpperCase() + ' ';
            ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
          } else {
            hex += '   ';
          }
        }
        html += `<div><span style="color:#444;">${offset}</span>  ${hex}  <span style="color:#00f0ff;">${ascii}</span></div>`;
      }
      content.innerHTML = html;
      return { destroy: () => {} };
    },
  });

  console.log(`[NEXUS] Registered ${registrations.length + 1} plugins`);
}
