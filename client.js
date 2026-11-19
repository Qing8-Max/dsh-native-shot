window.__ModuleLoader__.load({
  id: 'dsh-native-shot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const API = '/dsh-native-shot';
    const SNAP_PX = 12;

    const btnStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 28,
      height: 28,
      padding: '0 6px',
      border: '1px solid rgba(128,128,128,0.35)',
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: 14,
      lineHeight: 1,
      cursor: 'pointer',
    };

    // ---------- helpers ----------

    function toBlob(canvas) {
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    }

    function loadImage(blob) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('图片解码失败'));
        };
        img.src = url;
      });
    }

    function snapTo(value, candidates) {
      let best = value;
      let bestDist = SNAP_PX + 1;
      for (const candidate of candidates) {
        const dist = Math.abs(candidate - value);
        if (dist < bestDist) {
          bestDist = dist;
          best = candidate;
        }
      }
      return best;
    }

    async function grabScreen() {
      const res = await fetch(API + '/capture', { cache: 'no-store' });
      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = (j && j.error) || '';
        } catch (e) {}
        throw new Error('抓屏失败 HTTP ' + res.status + ' ' + detail);
      }
      const blob = await res.blob();
      if (!blob || blob.size < 500) throw new Error('截图内容异常');
      return blob;
    }

    async function grabWindows() {
      try {
        const res = await fetch(API + '/windows', { cache: 'no-store' });
        return await res.json();
      } catch (e) {
        return [];
      }
    }

    // ---------- region picker ----------

    function pickRegion(blob, windows) {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        const root = document.createElement('div');
        let disposed = false;

        const cleanup = () => {
          if (disposed) return;
          disposed = true;
          window.removeEventListener('keydown', onKey, true);
          URL.revokeObjectURL(url);
          if (root.parentNode) root.parentNode.removeChild(root);
        };

        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cleanup();
            resolve(null);
          }
        };

        root.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:2147483000',
          'background:rgba(0,0,0,0.45)', 'cursor:crosshair',
          'display:flex', 'align-items:center', 'justify-content:center',
          'user-select:none',
        ].join(';');

        const sel = document.createElement('div');
        sel.style.cssText = [
          'position:fixed', 'border:1px solid #4c9aff',
          'background:rgba(76,154,255,0.15)', 'display:none',
          'pointer-events:none', 'box-shadow:0 0 0 9999px rgba(0,0,0,0.45)',
        ].join(';');

        const hint = document.createElement('div');
        hint.textContent = '拖动框选（自动吸附窗口边缘）· 双击截全屏 · Esc 取消';
        hint.style.cssText = [
          'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
          'padding:6px 12px', 'border-radius:8px', 'font:13px/1.4 system-ui,sans-serif',
          'color:#fff', 'background:rgba(0,0,0,0.7)', 'pointer-events:none',
        ].join(';');

        let startX = 0;
        let startY = 0;
        let dragging = false;
        let xs = [];
        let ys = [];

        const onDown = (e) => {
          if (e.button !== 0) return;
          dragging = true;
          startX = e.clientX;
          startY = e.clientY;
          sel.style.display = 'block';
          sel.style.left = startX + 'px';
          sel.style.top = startY + 'px';
          sel.style.width = '0px';
          sel.style.height = '0px';
        };

        const onMove = (e) => {
          if (!dragging) return;
          const box = img.getBoundingClientRect();
          let left = Math.min(startX, e.clientX);
          let top = Math.min(startY, e.clientY);
          let right = Math.max(startX, e.clientX);
          let bottom = Math.max(startY, e.clientY);

          left = snapTo(left, xs);
          right = snapTo(right, xs);
          top = snapTo(top, ys);
          bottom = snapTo(bottom, ys);

          left = Math.max(box.left, Math.min(left, box.right));
          right = Math.max(box.left, Math.min(right, box.right));
          top = Math.max(box.top, Math.min(top, box.bottom));
          bottom = Math.max(box.top, Math.min(bottom, box.bottom));

          sel.style.left = left + 'px';
          sel.style.top = top + 'px';
          sel.style.width = Math.max(0, right - left) + 'px';
          sel.style.height = Math.max(0, bottom - top) + 'px';
        };

        const onUp = () => {
          if (!dragging) return;
          dragging = false;
          const rect = sel.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) {
            sel.style.display = 'none';
            return;
          }
          const box = img.getBoundingClientRect();
          const scaleX = img.naturalWidth / box.width;
          const scaleY = img.naturalHeight / box.height;
          const sx = Math.max(0, (rect.left - box.left) * scaleX);
          const sy = Math.max(0, (rect.top - box.top) * scaleY);
          const sw = Math.min(img.naturalWidth - sx, rect.width * scaleX);
          const sh = Math.min(img.naturalHeight - sy, rect.height * scaleY);
          if (sw < 2 || sh < 2) {
            sel.style.display = 'none';
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(sw);
          canvas.height = Math.round(sh);
          canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          cleanup();
          canvas.toBlob((out) => resolve(out), 'image/png');
        };

        const onDouble = (e) => {
          e.preventDefault();
          cleanup();
          resolve(blob);
        };

        img.onload = () => {
          img.style.cssText = 'max-width:100vw;max-height:100vh;display:block;pointer-events:none';
          const box = img.getBoundingClientRect();
          const scaleX = box.width / img.naturalWidth;
          const scaleY = box.height / img.naturalHeight;

          xs = [box.left, box.right];
          ys = [box.top, box.bottom];

          const outlines = document.createElement('div');
          if (Array.isArray(windows)) {
            for (const win of windows.slice(0, 40)) {
              if (!win || !win.w || !win.h) continue;
              const left = box.left + win.x * scaleX;
              const top = box.top + win.y * scaleY;
              const width = win.w * scaleX;
              const height = win.h * scaleY;
              if (left < box.left - 1 || top < box.top - 1) continue;
              if (left + width > box.right + 1 || top + height > box.bottom + 1) continue;
              xs.push(left, left + width);
              ys.push(top, top + height);
              const line = document.createElement('div');
              line.style.cssText = [
                'position:fixed', 'pointer-events:none',
                `left:${left}px`, `top:${top}px`, `width:${width}px`, `height:${height}px`,
                'border:1px dashed rgba(76,154,255,0.45)', 'border-radius:2px',
              ].join(';');
              outlines.appendChild(line);
            }
          }

          root.appendChild(img);
          root.appendChild(outlines);
          root.appendChild(sel);
          root.appendChild(hint);
          document.body.appendChild(root);
          root.addEventListener('mousedown', onDown);
          root.addEventListener('mousemove', onMove);
          root.addEventListener('mouseup', onUp);
          root.addEventListener('dblclick', onDouble);
          window.addEventListener('keydown', onKey, true);
        };
        img.onerror = () => {
          cleanup();
          resolve(null);
        };
        img.src = url;
      });
    }

    // ---------- editor (brush + recrop) ----------

    /**
     * Draw over the capture with a brush, or pick a new crop region.
     * Resolves with the edited PNG blob, or null when cancelled.
     */
    function editImage(blob) {
      return new Promise(async (resolve) => {
        let img;
        try {
          img = await loadImage(blob);
        } catch (e) {
          resolve(blob);
          return;
        }

        const root = document.createElement('div');
        root.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:2147483001',
          'background:rgba(15,17,21,0.92)',
          'display:flex', 'flex-direction:column',
          'align-items:center', 'justify-content:center',
          'gap:12px', 'user-select:none',
        ].join(';');

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx2d = canvas.getContext('2d');
        ctx2d.drawImage(img, 0, 0);

        const scale = Math.min(
          (window.innerWidth - 80) / img.naturalWidth,
          (window.innerHeight - 160) / img.naturalHeight,
          1,
        );
        canvas.style.cssText = [
          `width:${Math.round(img.naturalWidth * scale)}px`,
          `height:${Math.round(img.naturalHeight * scale)}px`,
          'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
          'cursor:crosshair',
          'border-radius:4px',
        ].join(';');

        const bar = document.createElement('div');
        bar.style.cssText = [
          'display:flex', 'align-items:center', 'gap:10px',
          'padding:8px 14px', 'border-radius:10px',
          'background:rgba(255,255,255,0.08)',
          'font:13px/1.4 system-ui,sans-serif', 'color:#e8eaed',
        ].join(';');

        const mkBtn = (text, onClick, active) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.style.cssText = [
            'padding:5px 10px', 'border-radius:7px', 'cursor:pointer',
            'border:1px solid rgba(255,255,255,0.25)',
            'background:' + (active ? '#4c9aff' : 'transparent'),
            'color:#fff', 'font:13px/1 system-ui,sans-serif',
          ].join(';');
          b.addEventListener('click', onClick);
          return b;
        };

        const COLORS = ['#ff4d4f', '#ffb020', '#4c9aff', '#22c55e', '#ffffff', '#111111'];
        let color = COLORS[0];
        let width = 4;
        let tool = 'brush';
        let drawing = false;
        let lastX = 0;
        let lastY = 0;
        let cropStart = null;
        let cropRect = null;
        const undoStack = [];
        const MAX_UNDO = 20;

        const pushUndo = () => {
          undoStack.push(ctx2d.getImageData(0, 0, canvas.width, canvas.height));
          if (undoStack.length > MAX_UNDO) undoStack.shift();
        };

        const toCanvas = (e) => {
          const rect = canvas.getBoundingClientRect();
          return {
            x: ((e.clientX - rect.left) / rect.width) * canvas.width,
            y: ((e.clientY - rect.top) / rect.height) * canvas.height,
          };
        };

        const onDown = (e) => {
          if (e.button !== 0) return;
          const p = toCanvas(e);
          if (tool === 'crop') {
            cropStart = p;
            cropRect = null;
            return;
          }
          pushUndo();
          drawing = true;
          lastX = p.x;
          lastY = p.y;
          ctx2d.strokeStyle = color;
          ctx2d.lineWidth = width;
          ctx2d.lineCap = 'round';
          ctx2d.lineJoin = 'round';
          ctx2d.beginPath();
          ctx2d.moveTo(p.x, p.y);
          ctx2d.lineTo(p.x + 0.01, p.y);
          ctx2d.stroke();
        };

        let cropOverlay = null;

        const redrawCrop = () => {
          if (cropOverlay && cropOverlay.parentNode) cropOverlay.parentNode.removeChild(cropOverlay);
          cropOverlay = null;
          if (!cropRect) return;
          const rect = cropRect;
          const canvasBox = canvas.getBoundingClientRect();
          const rootBox = root.getBoundingClientRect();
          const px = (rect.x / canvas.width) * canvasBox.width;
          const py = (rect.y / canvas.height) * canvasBox.height;
          const pw = (rect.w / canvas.width) * canvasBox.width;
          const ph = (rect.ht / canvas.height) * canvasBox.height;
          const div = document.createElement('div');
          div.style.cssText = [
            'position:fixed', 'pointer-events:none', 'z-index:2147483002',
            `left:${canvasBox.left - rootBox.left + px}px`,
            `top:${canvasBox.top - rootBox.top + py}px`,
            `width:${pw}px`, `height:${ph}px`,
            'border:2px solid #4c9aff', 'background:rgba(76,154,255,0.12)',
          ].join(';');
          root.appendChild(div);
          cropOverlay = div;
        };

        const onMove = (e) => {
          const p = toCanvas(e);
          if (tool === 'crop' && cropStart) {
            cropRect = {
              x: Math.max(0, Math.min(cropStart.x, p.x)),
              y: Math.max(0, Math.min(cropStart.y, p.y)),
              w: Math.min(canvas.width, Math.abs(p.x - cropStart.x)),
              ht: Math.min(canvas.height, Math.abs(p.y - cropStart.y)),
            };
            redrawCrop();
            return;
          }
          if (!drawing) return;
          ctx2d.strokeStyle = color;
          ctx2d.lineWidth = width;
          ctx2d.lineCap = 'round';
          ctx2d.lineJoin = 'round';
          ctx2d.beginPath();
          ctx2d.moveTo(lastX, lastY);
          ctx2d.lineTo(p.x, p.y);
          ctx2d.stroke();
          lastX = p.x;
          lastY = p.y;
        };

        const onUp = () => {
          if (tool === 'crop') {
            cropStart = null;
            return;
          }
          drawing = false;
        };

        const finish = (result) => {
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('mouseup', onUp);
          if (root.parentNode) root.parentNode.removeChild(root);
          resolve(result);
        };

        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            const prev = undoStack.pop();
            if (prev) ctx2d.putImageData(prev, 0, 0);
          }
        };

        const brushBtn = mkBtn('画笔', () => {
          tool = 'brush';
          syncTools();
        }, true);
        const cropBtn = mkBtn('裁剪', () => {
          tool = 'crop';
          cropRect = null;
          redrawCrop();
          syncTools();
        }, false);

        function syncTools() {
          brushBtn.style.background = tool === 'brush' ? '#4c9aff' : 'transparent';
          cropBtn.style.background = tool === 'crop' ? '#4c9aff' : 'transparent';
        }

        bar.appendChild(brushBtn);
        bar.appendChild(cropBtn);

        for (const c of COLORS) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.title = c;
          dot.style.cssText = [
            'width:20px', 'height:20px', 'border-radius:50%', 'cursor:pointer',
            'border:2px solid ' + (c === color ? '#fff' : 'rgba(255,255,255,0.3)'),
            'background:' + c, 'padding:0',
          ].join(';');
          dot.addEventListener('click', () => {
            color = c;
            tool = 'brush';
            syncTools();
            for (const child of bar.querySelectorAll('[data-color]')) {
              child.style.borderColor = child.dataset.color === color ? '#fff' : 'rgba(255,255,255,0.3)';
            }
          });
          dot.dataset.color = c;
          bar.appendChild(dot);
        }

        for (const w of [2, 4, 8]) {
          const b = mkBtn(String(w), () => {
            width = w;
            tool = 'brush';
            syncTools();
            for (const child of bar.querySelectorAll('[data-width]')) {
              child.style.borderColor = child.dataset.width === String(width) ? '#fff' : 'rgba(255,255,255,0.25)';
            }
          }, false);
          b.dataset.width = String(w);
          bar.appendChild(b);
        }

        bar.appendChild(
          mkBtn('撤销', () => {
            const prev = undoStack.pop();
            if (prev) ctx2d.putImageData(prev, 0, 0);
          }),
        );

        bar.appendChild(
          mkBtn('✓ 插入', async () => {
            if (tool === 'crop' && cropRect && cropRect.w > 4 && cropRect.ht > 4) {
              const out = document.createElement('canvas');
              out.width = Math.round(cropRect.w);
              out.height = Math.round(cropRect.ht);
              out.getContext('2d').drawImage(
                canvas,
                Math.round(cropRect.x), Math.round(cropRect.y),
                out.width, out.height,
                0, 0, out.width, out.height,
              );
              finish(await toBlob(out));
              return;
            }
            finish(await toBlob(canvas));
          }),
        );

        bar.appendChild(mkBtn('取消', () => finish(null)));

        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('keydown', onKey, true);

        root.appendChild(canvas);
        root.appendChild(bar);
        document.body.appendChild(root);
      });
    }

    // ---------- insert ----------

    function insertAsPaste(blob) {
      const file = new File([blob], 'screenshot.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
      document.dispatchEvent(ev);
    }

    // ---------- component ----------

    function ShotButton() {
      const [state, setState] = React.useState('idle');
      const [msg, setMsg] = React.useState('');
      const timer = React.useRef(null);

      const stopTimer = () => {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      };

      const flash = (text, kind) => {
        setMsg(text);
        setState(kind || 'idle');
        stopTimer();
        timer.current = setTimeout(() => {
          setMsg('');
          setState('idle');
        }, 6000);
      };

      React.useEffect(() => () => stopTimer(), []);

      const shoot = async () => {
        if (state === 'busy') return;
        setState('busy');
        stopTimer();
        try {
          setMsg('截屏中…');
          const [shot, windows] = await Promise.all([grabScreen(), grabWindows()]);

          setMsg('框选中…');
          const cropped = await pickRegion(shot, windows);
          if (!cropped) {
            flash('已取消', 'idle');
            return;
          }

          setMsg('编辑中…');
          const edited = await editImage(cropped);
          if (!edited) {
            flash('已取消', 'idle');
            return;
          }

          insertAsPaste(edited);
          flash('已插入 ' + Math.round(edited.size / 1024) + 'KB', 'ok');
        } catch (err) {
          flash('失败：' + ((err && err.message) || String(err)), 'err');
        }
      };

      const busy = state === 'busy';

      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h(
          'button',
          {
            type: 'button',
            onClick: shoot,
            disabled: busy,
            title: '截图（拖框选择 / 双击全屏 / 标注后插入）',
            style: Object.assign({}, btnStyle, busy ? { opacity: 0.6 } : null),
          },
          busy ? '⏳' : '📷',
        ),
        msg
          ? h(
              'span',
              {
                style: {
                  fontSize: 12,
                  opacity: 0.8,
                  color: state === 'err' ? '#e5534b' : 'inherit',
                  whiteSpace: 'nowrap',
                },
              },
              msg,
            )
          : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'dsh-native-shot', order: 5 },
            ShotButton,
          ),
        );
      },
    };
  },
});