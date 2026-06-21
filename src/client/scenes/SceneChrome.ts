// Chain Reaction — shared scene chrome (header annotations, prompt headline,
// toast bar, graph paper background). Used by PlayScene and ReplayScene.

import Phaser from 'phaser';
import { WORLD_W, WORLD_H } from '../../shared/constants';
import { COLOR, TYPE, GRID_PX } from '../design/tokens';
import { drawGraphPaper } from '../design/sketch';

export interface SceneHeader {
  templateId: string;   // "G2"
  day: number;          // 4
  seedShort: string;    // "8a3f"
  mode: 'play' | 'replay' | 'practice';
}

export class SceneChrome {
  private bg!: Phaser.GameObjects.Graphics;
  private headerL!: Phaser.GameObjects.Text;
  private headerR!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {}

  build(header: SceneHeader, prompt: string) {
    this.bg = this.scene.add.graphics().setDepth(0);
    this.bg.fillStyle(COLOR.paper, 1);
    this.bg.fillRect(0, 0, WORLD_W, WORLD_H);
    drawGraphPaper(this.bg, WORLD_W, WORLD_H, GRID_PX);

    // Top annotation strip — engineer's title block. Always mono.
    const left = `${header.templateId} · DAY ${pad(header.day + 1, 2)} · SEED ${header.seedShort}`;
    const right =
      header.mode === 'replay' ? 'REPLAY' :
      header.mode === 'practice' ? 'PRACTICE' : 'PLAY';
    this.headerL = this.scene.add.text(20, 16, left, TYPE.annotation).setDepth(100);
    this.headerR = this.scene.add.text(WORLD_W - 20, 16, right, {
      ...TYPE.annotation,
      color: header.mode === 'play' ? '#1F2024' : '#C8312B',
    }).setOrigin(1, 0).setDepth(100);

    // Hairline rule under the header.
    const rule = this.scene.add.graphics().setDepth(100);
    rule.lineStyle(1, COLOR.graphite, 0.4);
    rule.lineBetween(20, 44, WORLD_W - 20, 44);

    // Italic display headline — the prompt.
    this.prompt = this.scene.add.text(20, 64, prompt, TYPE.prompt).setDepth(100);

    // Toast bar — sits just above the palette tear-off (or near the bottom
    // when the palette is hidden). Mono so it reads as a system message.
    this.toast = this.scene.add.text(WORLD_W / 2, WORLD_H - 144, '', {
      ...TYPE.annotation,
      color: '#1F2024',
    }).setOrigin(0.5, 1).setDepth(100);
  }

  setToast(text: string, kind: 'info' | 'error' | 'success' = 'info') {
    const color =
      kind === 'error' ? '#C8312B' : kind === 'success' ? '#1B5E50' : '#1F2024';
    this.toast.setColor(color).setText(text);
  }

  setPrompt(text: string) {
    this.prompt.setText(text);
  }
}

function pad(n: number, width: number) {
  return n.toString().padStart(width, '0');
}
