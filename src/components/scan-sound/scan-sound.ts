import { useEffect } from 'react';

// The scratching sound taken from the user's video (public/assets/media/scan-scratch.mp3).
// One shared audio context and one decoded copy of the sound for every page that scans.
let ctx: any = null;
let buffer: Promise<any> | null = null;

const sound_url = () => `${(window as any).__webpack_public_path__ || '/'}assets/media/scan-scratch.mp3`;

/** Call from a click handler (browsers only allow sound after a click). */
export const unlockScanSound = () => {
    try {
        if (!ctx) {
            const AC = window.AudioContext || (window as any).webkitAudioContext;
            if (AC) ctx = new AC();
        }
        ctx?.resume?.();
    } catch (e) {
        // no sound available
    }
};

const loadBuffer = () => {
    if (!ctx) return Promise.reject(new Error('no audio'));
    if (!buffer) {
        buffer = fetch(sound_url())
            .then(r => r.arrayBuffer())
            .then(data => ctx.decodeAudioData(data))
            .catch(e => {
                buffer = null; // try again next time
                throw e;
            });
    }
    return buffer;
};

/** Plays the scratching sound on a loop for as long as `active` is true. */
export const useScanSound = (active: boolean) => {
    useEffect(() => {
        if (!active) return;
        unlockScanSound();
        if (!ctx) return;
        let src: any = null;
        let stopped = false;
        loadBuffer()
            .then(buf => {
                if (stopped) return;
                src = ctx.createBufferSource();
                src.buffer = buf;
                src.loop = true;
                const gain = ctx.createGain();
                gain.gain.value = 0.9;
                src.connect(gain);
                gain.connect(ctx.destination);
                src.start();
            })
            .catch(() => {
                // no sound available
            });
        return () => {
            stopped = true;
            try {
                src?.stop();
            } catch (e) {
                // already stopped
            }
        };
    }, [active]);
};
