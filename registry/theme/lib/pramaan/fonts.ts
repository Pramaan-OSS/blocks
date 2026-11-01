import { Fraunces, Geist, JetBrains_Mono } from "next/font/google";

// The three fonts the Pramaan theme reads: Geist for the interface, Fraunces for headings,
// JetBrains Mono for code facts. Put the result on <html>:
//   <html lang="en" className={pramaanFonts}>
// theme.css falls back to system fonts if one fails to load.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", weight: ["400", "500", "600"], display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz", "SOFT"], display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"], display: "swap" });

export const pramaanFonts = [geist, fraunces, jetbrains].map((f) => f.variable).join(" ");
