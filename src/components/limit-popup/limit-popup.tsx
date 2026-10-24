import React from 'react';
import { localize } from '@deriv-com/translations';

export type LimitKind = 'tp' | 'sl' | null;

// Popup shown when a take profit or stop loss stops the trading (Over One, Under 8, Market Insights)
// `z_index` lets a page that has its own full-screen window (like the Scanner Bot) show the popup in front of it
const LimitPopup = ({ kind, onClose, z_index = 10000 }: { kind: LimitKind; onClose: () => void; z_index?: number }) => {
    if (!kind) return null;
    const is_tp = kind === 'tp';
    const text = is_tp
        ? 'Everyday will be Eid and every night Diwali🤲🎉'
        : 'sorry stop loss reached we try again later😴';
    return (
        <div
            role='dialog'
            aria-modal='true'
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: z_index,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                background: 'rgba(0,0,0,0.6)',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    maxWidth: 360,
                    width: '100%',
                    textAlign: 'center',
                    padding: '28px 22px 22px',
                    borderRadius: 16,
                    color: '#fff',
                    background: is_tp
                        ? 'linear-gradient(135deg,#0a7a4b,#14b86e)'
                        : 'linear-gradient(135deg,#7a1020,#c0283c)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                }}
            >
                <p style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, lineHeight: 1.4 }}>{localize(text)}</p>
                <button
                    type='button'
                    onClick={onClose}
                    style={{
                        border: 0,
                        borderRadius: 10,
                        padding: '10px 28px',
                        fontSize: 15,
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: '#fff',
                        color: is_tp ? '#0a7a4b' : '#7a1020',
                    }}
                >
                    OK
                </button>
            </div>
        </div>
    );
};

export default LimitPopup;
