/**
 * Icon shim.
 *
 * `react-icons` types every icon as `IconType = (props) => ReactNode`,
 * and `ReactNode` in `@types/react@16.14` includes `undefined`. Modern
 * TypeScript (5.3+) refuses to use such a component as a JSX element
 * because `JSX.Element` is `ReactElement | null`, not `ReactNode`.
 *
 * Rather than turn off strict mode for the whole plugin, we wrap each
 * icon we use in a tiny FC shim that strips `undefined` from the return
 * type. The runtime behaviour is unchanged (the original component is
 * still what renders), only the type signature is narrowed.
 *
 * Centralising the imports here also doubles as a "what icons do we
 * actually use?" registry — keeps the bundle small under tree-shaking.
 */

import type { CSSProperties, FC, ReactElement } from "react";
import {
    FaHammer as RawFaHammer,
    FaPlus as RawFaPlus,
    FaSyncAlt as RawFaSyncAlt,
    FaTrash as RawFaTrash,
} from "react-icons/fa";

export interface IconProps {
    style?: CSSProperties;
    size?: number | string;
    color?: string;
    title?: string;
    className?: string;
}

function shim(raw: unknown): FC<IconProps> {
    return raw as unknown as (props: IconProps) => ReactElement;
}

export const FaHammer = shim(RawFaHammer);
export const FaPlus = shim(RawFaPlus);
export const FaSyncAlt = shim(RawFaSyncAlt);
export const FaTrash = shim(RawFaTrash);
