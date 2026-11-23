import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names and let later Tailwind classes win over earlier ones. */
export const cn = (...inputs: ReadonlyArray<ClassValue>): string => twMerge(clsx(inputs));
