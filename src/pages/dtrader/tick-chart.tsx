import React, { useEffect, useRef } from 'react';

type TTick = { epoch: number; quote: number };

const TickChart = ({ ticks }: { ticks: TTick[] }) => {
    const wrap = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const draw = () => {
            const el = wrap.current;
            const cv = canvas.current;
            if (!el || !cv) return;
            const dpr = window.devicePixelRatio || 1;
            const w = el.clientWidth;
            const h = el.clientHeight;
            cv.width = w * dpr;
            cv.height = h * dpr;
            cv.style.width = `${w}px`;
            cv.style.height = `${h}px`;
            const ctx = cv.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            if (ticks.length < 2) return;

            const styles = getComputedStyle(el);
            const text = styles.getPropertyValue('--text-general').trim() || '#333';
            const line = styles.getPropertyValue('--general-main-1').trim() || '#85acb0';

            const pad_r = 64;
            const pad_b = 24;
            const pad_t = 12;
            const plot_w = w - pad_r;
            const plot_h = h - pad_b - pad_t;
            const quotes = ticks.map(t => t.quote);
            let min = Math.min(...quotes);
            let max = Math.max(...quotes);
            if (min === max) {
                min -= 1;
                max += 1;
            }
            const margin = (max - min) * 0.1;
            min -= margin;
            max += margin;
            const x = (i: number) => (i / (ticks.length - 1)) * plot_w;
            const y = (q: number) => pad_t + (1 - (q - min) / (max - min)) * plot_h;

            // grid + price labels
            ctx.font = '11px sans-serif';
            ctx.fillStyle = text;
            ctx.strokeStyle = 'rgba(128,128,128,0.2)';
            ctx.lineWidth = 1;
            for (let g = 0; g <= 4; g++) {
                const q = min + ((max - min) * g) / 4;
                const gy = y(q);
                ctx.beginPath();
                ctx.moveTo(0, gy);
                ctx.lineTo(plot_w, gy);
                ctx.stroke();
                ctx.fillText(q.toFixed(2), plot_w + 6, gy + 4);
            }
            // time labels
            [0, Math.floor(ticks.length / 2), ticks.length - 1].forEach(i => {
                const d = new Date(ticks[i].epoch * 1000);
                const label = d.toISOString().slice(11, 19);
                const lx = Math.min(Math.max(x(i) - 24, 0), plot_w - 48);
                ctx.fillText(label, lx, h - 6);
            });

            // area
            ctx.beginPath();
            ctx.moveTo(x(0), y(ticks[0].quote));
            ticks.forEach((t, i) => ctx.lineTo(x(i), y(t.quote)));
            ctx.lineTo(x(ticks.length - 1), pad_t + plot_h);
            ctx.lineTo(x(0), pad_t + plot_h);
            ctx.closePath();
            ctx.fillStyle = 'rgba(128,128,128,0.12)';
            ctx.fill();

            // line
            ctx.beginPath();
            ticks.forEach((t, i) => (i ? ctx.lineTo(x(i), y(t.quote)) : ctx.moveTo(x(i), y(t.quote))));
            ctx.strokeStyle = text;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // last price marker
            const last = ticks[ticks.length - 1];
            const ly = y(last.quote);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = line;
            ctx.beginPath();
            ctx.moveTo(0, ly);
            ctx.lineTo(plot_w, ly);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = text;
            ctx.beginPath();
            ctx.arc(x(ticks.length - 1), ly, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#0e0e0e';
            ctx.fillRect(plot_w + 2, ly - 9, pad_r - 4, 18);
            ctx.fillStyle = '#fff';
            ctx.fillText(last.quote.toFixed(2), plot_w + 6, ly + 4);
        };

        draw();
        const ro = new ResizeObserver(draw);
        if (wrap.current) ro.observe(wrap.current);
        return () => ro.disconnect();
    }, [ticks]);

    return (
        <div ref={wrap} className='dtrader__chart-wrap'>
            <canvas ref={canvas} />
        </div>
    );
};

export default TickChart;
