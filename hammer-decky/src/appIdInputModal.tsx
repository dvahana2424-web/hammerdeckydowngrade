/**
 * AppID / Store URL entry via ConfirmModal.
 *
 * Inline PanelSection TextField stopped accepting keyboard input after
 * recent SteamOS / SteamUI updates — the OSK focus path only works
 * reliably inside a modal on Game Mode. This matches the pattern used
 * by other Decky plugins (ConfirmModal + Field + TextField).
 */

import { ConfirmModal, Field, TextField, showModal } from "@decky/ui";
import { FC, useState } from "react";

interface AppIdInputModalProps {
    initial?: string;
    onDone: (value: string | null) => void;
    closeModal?: () => void;
}

const AppIdInputModalBody: FC<AppIdInputModalProps> = ({
    initial = "",
    onDone,
    closeModal,
}) => {
    const [val, setVal] = useState(initial);

    const finish = (value: string | null) => {
        onDone(value);
        closeModal?.();
    };

    return (
        <ConfirmModal
            strTitle="Enter AppID or Store URL"
            strDescription={
                "Paste a Steam store link or type a numeric AppID. " +
                "If the keyboard does not appear, press Steam + X."
            }
            strOKButtonText="Done"
            strCancelButtonText="Cancel"
            bOKDisabled={!val.trim()}
            onOK={() => finish(val.trim())}
            onCancel={() => finish(null)}
            closeModal={closeModal}
        >
            <Field label="AppID or Steam Store URL">
                <TextField
                    value={val}
                    onChange={(e) => setVal(e?.target?.value ?? "")}
                    style={{ width: "100%", minWidth: "220px" }}
                />
            </Field>
        </ConfirmModal>
    );
};

/** Open the input modal; resolves to trimmed text or null if cancelled. */
export function showAppIdInputModal(opts: { initial?: string } = {}): Promise<string | null> {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (v: string | null) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };

        showModal(
            <AppIdInputModalBody
                initial={opts.initial ?? ""}
                onDone={settle}
            />,
        );
    });
}
