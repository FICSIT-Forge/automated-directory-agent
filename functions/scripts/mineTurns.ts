/**
 * CLI for production-traffic triage (issue #7) — thin wrapper around
 * src/mining/turnMiner.ts, which holds all the logic (and its tests).
 *
 * Usage:
 *   pnpm mine:turns                 # last 7 days
 *   pnpm mine:turns --days 14
 *   pnpm mine:turns --out eval/turn-candidates.json
 *
 * Requirements: Application Default Credentials with Firestore read access
 * to ficsit-forge (`gcloud auth application-default login`).
 */

import * as fs from "fs";
import * as path from "path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { TurnMiner } from "../src/mining/turnMiner.js";

const PROJECT = "ficsit-forge";
const EVAL_DIR = path.resolve(import.meta.dirname, "../eval");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DAYS = Number(argValue("--days")) || 7;
const OUT_PATH = path.resolve(
  argValue("--out") ?? path.join(EVAL_DIR, "turn-candidates.json"),
);

async function main() {
  console.log(`Reading ${DAYS}d of turns + feedback from ${PROJECT}...`);
  if (!getApps().length) initializeApp({ projectId: PROJECT });
  const miner = new TurnMiner(getFirestore());

  let result: Awaited<ReturnType<TurnMiner["mine"]>>;
  try {
    result = await miner.mine(DAYS);
  } catch (e) {
    console.error(
      "FAIL: could not read Firestore. Are Application Default Credentials " +
        `set up with access to ${PROJECT}?\n` +
        (e instanceof Error ? e.message : String(e)),
    );
    process.exit(1);
  }

  const { turns, feedback, candidates } = result;
  const errors = candidates.filter((c) => c.error).length;
  const downs = candidates.filter((c) => c.feedback === "down").length;
  console.log(
    `\n${turns.length} turns → ${candidates.length} unique questions ` +
      `(${errors} errored, ${downs} thumbs-down, ${feedback.size} with feedback)`,
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(candidates, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(
    "\nNext: label the top candidates into eval/gold-set.json " +
      "(Layer 2) or eval/accuracy_dataset (Layer 3, issue #10).",
  );
}

main();
