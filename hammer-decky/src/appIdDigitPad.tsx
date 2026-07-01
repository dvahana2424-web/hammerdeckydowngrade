/**
 * Gamepad-friendly numeric AppID entry — no OS keyboard required.
 * Useful when SteamOS updates break inline TextField / on-screen keyboard.
 */

import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { FC, CSSProperties } from "react";

interface AppIdDigitPadProps {
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
}

const digitBtn: CSSProperties = {
    minWidth: "44px",
    padding: "6px 10px",
    fontWeight: 700,
};

export const AppIdDigitPad: FC<AppIdDigitPadProps> = ({ value, onChange, disabled }) => {
    const press = (d: string) => {
        if (disabled) return;
        if (value.length >= 9) return;
        onChange(value + d);
    };
    const backspace = () => {
        if (disabled || !value) return;
        onChange(value.slice(0, -1));
    };
    const clear = () => {
        if (disabled) return;
        onChange("");
    };

    const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

    return (
        <PanelSectionRow>
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                <div style={{ fontSize: "13px", opacity: 0.85 }}>
                    Numeric keypad (no keyboard needed):{" "}
                    <span style={{ fontWeight: 700 }}>{value || "—"}</span>
                </div>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: "6px",
                        width: "100%",
                    }}
                >
                    {digits.map((d) => (
                        <DialogButton
                            key={d}
                            disabled={disabled}
                            onClick={() => press(d)}
                            style={digitBtn}
                        >
                            {d}
                        </DialogButton>
                    ))}
                    <DialogButton disabled={disabled || !value} onClick={backspace} style={digitBtn}>
                        ⌫
                    </DialogButton>
                    <DialogButton disabled={disabled || !value} onClick={clear} style={digitBtn}>
                        CLR
                    </DialogButton>
                </div>
            </Focusable>
        </PanelSectionRow>
    );
};
