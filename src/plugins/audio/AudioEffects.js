const PRESETS = {
  'flat': {},
  'vocal-boost': { eq: [{ freq: 200, gain: -2 }, { freq: 3000, gain: 3 }, { freq: 8000, gain: 2 }] },
  'bass-boost': { eq: [{ freq: 80, gain: 6 }, { freq: 200, gain: 3 }] },
  'treble-boost': { eq: [{ freq: 4000, gain: 4 }, { freq: 8000, gain: 5 }, { freq: 12000, gain: 4 }] },
  'podcast': { compressor: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 }, eq: [{ freq: 200, gain: -3 }, { freq: 5000, gain: 2 }] },
  'loudness': { compressor: { threshold: -18, ratio: 6, attack: 0.005, release: 0.15 }, gain: 1.4 },
  'radio': { eq: [{ freq: 100, gain: -8 }, { freq: 2000, gain: 4 }, { freq: 6000, gain: -2 }], compressor: { threshold: -20, ratio: 8, attack: 0.001, release: 0.1 } },
  'hall': { reverb: { duration: 2.5, decay: 2.5, mix: 0.4 } },
  'cathedral': { reverb: { duration: 4, decay: 3, mix: 0.5 } },
  'room': { reverb: { duration: 0.8, decay: 1.2, mix: 0.25 } },
};

export class AudioEffectsChain {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.nodes = {};
    this.enabled = {
      gain: true, eq: true, compressor: true,
      distortion: false, reverb: false, delay: false, pitch: false,
    };
    this.params = {
      gain: 1.0,
      eq: [{ freq: 100, gain: 0, q: 1 }, { freq: 500, gain: 0, q: 1 }, { freq: 2000, gain: 0, q: 1 }, { freq: 6000, gain: 0, q: 1 }, { freq: 12000, gain: 0, q: 1 }],
      compressor: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25 },
      distortion: { amount: 20, oversample: '2x' },
      reverb: { duration: 2, decay: 2, mix: 0.3 },
      delay: { time: 0.3, feedback: 0.4, mix: 0.3 },
      pitch: { semitones: 0 },
    };
    this._build();
  }

  _build() {
    const ctx = this.ctx;
    this.nodes.input = ctx.createGain();
    this.nodes.output = ctx.createGain();
    this.nodes.gain = ctx.createGain();
    this.nodes.compressor = ctx.createDynamicsCompressor();
    this.nodes.eqBands = this.params.eq.map(b => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = b.freq;
      filter.Q.value = b.q;
      filter.gain.value = b.gain;
      return filter;
    });
    this.nodes.distortion = ctx.createWaveShaper();
    this.nodes.distortion.curve = this._makeDistortionCurve(this.params.distortion.amount);
    this.nodes.distortion.oversample = this.params.distortion.oversample;
    this.nodes.reverb = ctx.createConvolver();
    this.nodes.reverb.buffer = this._generateImpulse(2, 2);
    this.nodes.reverbMix = ctx.createGain();
    this.nodes.reverbDry = ctx.createGain();
    this.nodes.delay = ctx.createDelay(2);
    this.nodes.delayFeedback = ctx.createGain();
    this.nodes.delayMix = ctx.createGain();
    this.nodes.analyser = ctx.createAnalyser();
    this.nodes.analyser.fftSize = 2048;

    this._updateCompressor();
    this._updateGain();
    this._updateReverbMix();
    this._updateDelay();
    this._rebuildChain();
  }

  _rebuildChain() {
    const n = this.nodes;
    try { n.input.disconnect(); } catch {}
    try { n.gain.disconnect(); } catch {}
    try { n.compressor.disconnect(); } catch {}
    try { n.eqBands.forEach(b => b.disconnect()); } catch {}
    try { n.distortion.disconnect(); } catch {}
    try { n.reverb.disconnect(); } catch {}
    try { n.reverbMix.disconnect(); } catch {}
    try { n.reverbDry.disconnect(); } catch {}
    try { n.delay.disconnect(); } catch {}
    try { n.delayFeedback.disconnect(); } catch {}
    try { n.delayMix.disconnect(); } catch {}
    try { n.analyser.disconnect(); } catch {}

    let current = n.input;

    if (this.enabled.gain) {
      current.connect(n.gain);
      current = n.gain;
    }

    if (this.enabled.compressor) {
      current.connect(n.compressor);
      current = n.compressor;
    }

    if (this.enabled.eq) {
      for (const band of n.eqBands) {
        current.connect(band);
        current = band;
      }
    }

    if (this.enabled.distortion) {
      current.connect(n.distortion);
      current = n.distortion;
    }

    if (this.enabled.delay) {
      current.connect(n.delay);
      n.delay.connect(n.delayFeedback);
      n.delayFeedback.connect(n.delay);
      current.connect(n.delayMix);
      n.delayMix.connect(n.output);
    }

    if (this.enabled.reverb) {
      current.connect(n.reverb);
      n.reverb.connect(n.reverbMix);
      n.reverbMix.connect(n.output);
      current.connect(n.reverbDry);
      n.reverbDry.connect(n.output);
    } else {
      current.connect(n.output);
    }

    n.output.connect(n.analyser);
  }

  connectSource(source) {
    try { source.disconnect(); } catch {}
    source.connect(this.nodes.input);
  }

  connectToDestination(dest) {
    this.nodes.analyser.disconnect();
    this.nodes.analyser.connect(dest);
  }

  getOutput() {
    return this.nodes.analyser;
  }

  setParam(name, value) {
    this.params[name] = { ...this.params[name], ...value };
    switch (name) {
      case 'gain': this._updateGain(); break;
      case 'eq': this._updateEQ(); break;
      case 'compressor': this._updateCompressor(); break;
      case 'distortion':
        this.nodes.distortion.curve = this._makeDistortionCurve(value.amount);
        this.nodes.distortion.oversample = value.oversample || '2x';
        break;
      case 'reverb':
        this.nodes.reverb.buffer = this._generateImpulse(value.duration, value.decay);
        this._updateReverbMix();
        break;
      case 'delay': this._updateDelay(); break;
    }
  }

  setEnabled(name, enabled) {
    this.enabled[name] = enabled;
    this._rebuildChain();
  }

  _updateGain() {
    this.nodes.gain.gain.value = this.params.gain;
  }

  _updateEQ() {
    for (let i = 0; i < this.nodes.eqBands.length; i++) {
      const band = this.nodes.eqBands[i];
      const p = this.params.eq[i];
      if (!p) continue;
      band.frequency.value = p.freq;
      band.Q.value = p.q;
      band.gain.value = p.gain;
    }
  }

  _updateCompressor() {
    const c = this.nodes.compressor;
    const p = this.params.compressor;
    c.threshold.value = p.threshold;
    c.knee.value = p.knee;
    c.ratio.value = p.ratio;
    c.attack.value = p.attack;
    c.release.value = p.release;
  }

  _updateReverbMix() {
    const mix = this.params.reverb.mix;
    this.nodes.reverbMix.gain.value = mix;
    this.nodes.reverbDry.gain.value = 1 - mix;
  }

  _updateDelay() {
    const p = this.params.delay;
    this.nodes.delay.delayTime.value = p.time;
    this.nodes.delayFeedback.gain.value = p.feedback;
    this.nodes.delayMix.gain.value = p.mix;
  }

  _makeDistortionCurve(amount) {
    const k = amount;
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = i * 2 / n - 1;
      curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  _generateImpulse(duration, decay) {
    const rate = this.ctx.sampleRate;
    const length = rate * duration;
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    if (preset.gain != null) this.setParam('gain', { value: preset.gain });
    if (preset.eq) {
      const newEQ = this.params.eq.map(b => ({ ...b }));
      for (const { freq, gain } of preset.eq) {
        const band = newEQ.find(b => b.freq === freq);
        if (band) band.gain = gain;
        else newEQ.push({ freq, gain, q: 1 });
      }
      this.setParam('eq', newEQ);
    }
    if (preset.compressor) this.setParam('compressor', { ...this.params.compressor, ...preset.compressor });
    if (preset.reverb) {
      this.setEnabled('reverb', true);
      this.setParam('reverb', preset.reverb);
    }
  }

  getAnalyserData() {
    const freqData = new Uint8Array(this.nodes.analyser.frequencyBinCount);
    const timeData = new Uint8Array(this.nodes.analyser.fftSize);
    this.nodes.analyser.getByteFrequencyData(freqData);
    this.nodes.analyser.getByteTimeDomainData(timeData);
    return { freqData, timeData };
  }

  destroy() {
    try { this.nodes.input.disconnect(); } catch {}
    try { this.nodes.output.disconnect(); } catch {}
    try { this.nodes.analyser.disconnect(); } catch {}
  }
}

export const AudioEffectsPlugin = {
  type: 'AUDIO_EFFECTS',
  name: 'Audio Effects',

  async init(surface, tools, file) {
    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#0a0a0a;overflow:hidden;">
        <div style="flex-shrink:0;padding:12px;border-bottom:1px solid #222;">
          <canvas id="afx-visualizer" style="width:100%;height:100px;background:#050505;border-radius:4px;"></canvas>
        </div>
        <div style="flex:1;overflow-y:auto;padding:14px;">
          <div id="afx-presets" style="margin-bottom:16px;">
            <div style="font-size:10px;font-weight:bold;color:var(--nexus-cyan);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Presets</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;" id="afx-preset-grid"></div>
          </div>
          <div id="afx-panels"></div>
        </div>
        <div style="flex-shrink:0;height:48px;background:#0f0f0f;border-top:1px solid #222;display:flex;align-items:center;padding:0 12px;gap:8px;">
          <audio id="afx-audio" controls style="flex:1;height:32px;"></audio>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="afx-apply" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;">
          <i class="fas fa-save"></i> Apply Effects
        </button>
        <button id="afx-reset" style="background:transparent;color:#ff003c;border:1px solid #ff003c;padding:6px;border-radius:3px;font-size:12px;cursor:pointer;">
          <i class="fas fa-undo"></i> Reset All
        </button>
        <div style="border-top:1px solid #333;padding-top:8px;font-size:10px;color:#666;line-height:1.6;">
          Effects are applied in real-time. Use "Apply Effects" to render offline.
        </div>
      </div>
    `;

    const url = URL.createObjectURL(file.blob);
    const audioEl = document.getElementById('afx-audio');
    audioEl.src = url;
    audioEl.crossOrigin = 'anonymous';

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(audioEl);
    const chain = new AudioEffectsChain(ctx);
    chain.connectSource(source);
    chain.connectToDestination(ctx.destination);

    const visualizerCanvas = document.getElementById('afx-visualizer');
    const visCtx = visualizerCanvas.getContext('2d');
    let visRaf = null;

    const drawVisualizer = () => {
      const rect = visualizerCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      visualizerCanvas.width = rect.width * dpr;
      visualizerCanvas.height = rect.height * dpr;
      visCtx.scale(dpr, dpr);
      const w = rect.width;
      const h = rect.height;
      const { freqData, timeData } = chain.getAnalyserData();

      const loop = () => {
        const { freqData: f, timeData: t } = chain.getAnalyserData();
        visCtx.fillStyle = 'rgba(5,5,5,0.3)';
        visCtx.fillRect(0, 0, w, h);

        visCtx.strokeStyle = '#00f0ff';
        visCtx.lineWidth = 1;
        visCtx.beginPath();
        const step = Math.floor(t.length / w);
        for (let i = 0; i < w; i++) {
          const v = (t[i * step] - 128) / 128;
          const y = h / 2 + v * (h / 2 - 4);
          if (i === 0) visCtx.moveTo(i, y);
          else visCtx.lineTo(i, y);
        }
        visCtx.stroke();

        const barCount = 64;
        const barW = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * (f.length / 2));
          const v = f[idx] / 255;
          const barH = v * (h * 0.6);
          const hue = 180 + v * 60;
          visCtx.fillStyle = `hsl(${hue}, 100%, ${40 + v * 30}%)`;
          visCtx.fillRect(i * barW, h - barH, barW - 1, barH);
        }

        visRaf = requestAnimationFrame(loop);
      };
      loop();
    };

    const presetGrid = document.getElementById('afx-preset-grid');
    for (const name of Object.keys(PRESETS)) {
      const btn = document.createElement('button');
      btn.textContent = name.replace(/-/g, ' ');
      btn.style.cssText = 'padding:6px 4px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;text-transform:capitalize;';
      btn.addEventListener('click', () => {
        chain.applyPreset(name);
        renderPanels();
        window.__NEXUS_DI?.app?.notifications?.show(`Preset: ${name}`, 'success', 1500);
      });
      presetGrid.appendChild(btn);
    }

    const panelsEl = document.getElementById('afx-panels');

    const buildSlider = (label, min, max, step, value, onChange) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:11px;color:#888;flex:0 0 80px;';
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = min;
      inp.max = max;
      inp.step = step;
      inp.value = value;
      inp.style.cssText = 'flex:1;accent-color:var(--nexus-cyan);';
      const val = document.createElement('span');
      val.textContent = parseFloat(value).toFixed(2);
      val.style.cssText = 'font-size:10px;color:#666;min-width:40px;font-family:monospace;text-align:right;';
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        val.textContent = v.toFixed(2);
        onChange(v);
      });
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      wrap.appendChild(val);
      return wrap;
    };

    const buildToggle = (label, enabled, onChange) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1a1a1a;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:12px;color:#ccc;';
      const btn = document.createElement('button');
      btn.textContent = enabled ? 'ON' : 'OFF';
      btn.style.cssText = `padding:3px 10px;background:${enabled ? 'rgba(0,240,255,0.2)' : '#1a1a1a'};color:${enabled ? 'var(--nexus-cyan)' : '#666'};border:1px solid ${enabled ? 'var(--nexus-cyan)' : '#333'};border-radius:3px;font-size:10px;cursor:pointer;font-weight:bold;`;
      btn.addEventListener('click', () => {
        const nv = !chain.enabled[label.toLowerCase().replace(/\s/g, '')];
        onChange(nv);
        btn.textContent = nv ? 'ON' : 'OFF';
        btn.style.background = nv ? 'rgba(0,240,255,0.2)' : '#1a1a1a';
        btn.style.color = nv ? 'var(--nexus-cyan)' : '#666';
        btn.style.borderColor = nv ? 'var(--nexus-cyan)' : '#333';
      });
      wrap.appendChild(lbl);
      wrap.appendChild(btn);
      return wrap;
    };

    const buildSection = (title) => {
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-bottom:16px;border:1px solid #1a1a1a;border-radius:6px;padding:10px;background:#0f0f0f;';
      sec.innerHTML = `<div style="font-size:10px;font-weight:bold;color:var(--nexus-cyan);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${title}</div>`;
      return sec;
    };

    const renderPanels = () => {
      panelsEl.innerHTML = '';

      const gainSec = buildSection('Gain');
      gainSec.appendChild(buildSlider('Level', 0, 3, 0.01, chain.params.gain, (v) => {
        chain.params.gain = v;
        chain._updateGain();
      }));
      panelsEl.appendChild(gainSec);

      const compSec = buildSection('Compressor');
      compSec.appendChild(buildToggle('Compressor', chain.enabled.compressor, (v) => chain.setEnabled('compressor', v)));
      const cp = chain.params.compressor;
      compSec.appendChild(buildSlider('Threshold', -60, 0, 1, cp.threshold, (v) => { cp.threshold = v; chain._updateCompressor(); }));
      compSec.appendChild(buildSlider('Ratio', 1, 20, 0.5, cp.ratio, (v) => { cp.ratio = v; chain._updateCompressor(); }));
      compSec.appendChild(buildSlider('Attack', 0, 1, 0.001, cp.attack, (v) => { cp.attack = v; chain._updateCompressor(); }));
      compSec.appendChild(buildSlider('Release', 0, 1, 0.01, cp.release, (v) => { cp.release = v; chain._updateCompressor(); }));
      panelsEl.appendChild(compSec);

      const eqSec = buildSection('5-Band EQ');
      eqSec.appendChild(buildToggle('EQ', chain.enabled.eq, (v) => chain.setEnabled('eq', v)));
      const freqs = [100, 500, 2000, 6000, 12000];
      for (let i = 0; i < chain.params.eq.length; i++) {
        const band = chain.params.eq[i];
        eqSec.appendChild(buildSlider(`${freqs[i]}Hz`, -15, 15, 0.5, band.gain, (v) => {
          band.gain = v;
          chain._updateEQ();
        }));
      }
      panelsEl.appendChild(eqSec);

      const distSec = buildSection('Distortion');
      distSec.appendChild(buildToggle('Distortion', chain.enabled.distortion, (v) => chain.setEnabled('distortion', v)));
      distSec.appendChild(buildSlider('Amount', 0, 100, 1, chain.params.distortion.amount, (v) => {
        chain.params.distortion.amount = v;
        chain.nodes.distortion.curve = chain._makeDistortionCurve(v);
      }));
      panelsEl.appendChild(distSec);

      const revSec = buildSection('Reverb');
      revSec.appendChild(buildToggle('Reverb', chain.enabled.reverb, (v) => chain.setEnabled('reverb', v)));
      revSec.appendChild(buildSlider('Duration', 0.1, 5, 0.1, chain.params.reverb.duration, (v) => {
        chain.params.reverb.duration = v;
        chain.nodes.reverb.buffer = chain._generateImpulse(v, chain.params.reverb.decay);
      }));
      revSec.appendChild(buildSlider('Decay', 0.5, 5, 0.1, chain.params.reverb.decay, (v) => {
        chain.params.reverb.decay = v;
        chain.nodes.reverb.buffer = chain._generateImpulse(chain.params.reverb.duration, v);
      }));
      revSec.appendChild(buildSlider('Mix', 0, 1, 0.01, chain.params.reverb.mix, (v) => {
        chain.params.reverb.mix = v;
        chain._updateReverbMix();
      }));
      panelsEl.appendChild(revSec);

      const delaySec = buildSection('Delay');
      delaySec.appendChild(buildToggle('Delay', chain.enabled.delay, (v) => chain.setEnabled('delay', v)));
      delaySec.appendChild(buildSlider('Time', 0.01, 1.5, 0.01, chain.params.delay.time, (v) => {
        chain.params.delay.time = v;
        chain._updateDelay();
      }));
      delaySec.appendChild(buildSlider('Feedback', 0, 0.9, 0.01, chain.params.delay.feedback, (v) => {
        chain.params.delay.feedback = v;
        chain._updateDelay();
      }));
      delaySec.appendChild(buildSlider('Mix', 0, 1, 0.01, chain.params.delay.mix, (v) => {
        chain.params.delay.mix = v;
        chain._updateDelay();
      }));
      panelsEl.appendChild(delaySec);
    };

    renderPanels();
    setTimeout(drawVisualizer, 100);

    document.getElementById('afx-apply').addEventListener('click', async () => {
      const app = window.__NEXUS_DI?.app;
      app?.notifications?.show('Real-time effects active. Use MediaRecorder for offline render.', 'info', 3000);
    });

    document.getElementById('afx-reset').addEventListener('click', () => {
      chain.applyPreset('flat');
      chain.enabled = { gain: true, eq: true, compressor: true, distortion: false, reverb: false, delay: false, pitch: false };
      chain._rebuildChain();
      renderPanels();
      app?.notifications?.show('Reset', 'info', 1500);
    });

    audioEl.addEventListener('play', () => {
      if (ctx.state === 'suspended') ctx.resume();
    });

    return {
      chain,
      destroy: () => {
        if (visRaf) cancelAnimationFrame(visRaf);
        chain.destroy();
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
        URL.revokeObjectURL(url);
        ctx.close().catch(() => {});
      },
    };
  },
};
