/**
 * i18n.js — ことばの切り替え（日本語 / 英語）
 *
 * ページの <html lang="…"> で決める。index.html は日本語、en.html は英語。
 * 文字を出す所では L('日本語', 'English') と、両方を並べて書く（どちらの意味かがその場でわかるように）。
 * Node.js（テスト）では document がないので、日本語になる。
 */
import { NOTE_JA, NOTE_EN } from './dsp.js';

export const LANG = typeof document !== 'undefined' && /^en/i.test(document.documentElement.lang || '') ? 'en' : 'ja';

/** 日本語のページなら ja、英語のページなら en を返す */
export const L = (ja, en) => (LANG === 'en' ? en : ja);

/** 音名（ド=0 … シ=11）。日本語はドレミ、英語は C D E */
export const noteName = (pc) => (LANG === 'en' ? NOTE_EN : NOTE_JA)[((pc % 12) + 12) % 12];

/** 時計の向き：「9時」/「9 o'clock」 */
export const clockText = (hour) => L(`${hour}時`, `${hour}\u00a0o'clock`); // 英語は「9 o'clock」の途中で折り返さない
