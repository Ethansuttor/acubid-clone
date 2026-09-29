// The C1 contract suite run against the desktop SQLite adapter (track S2),
// each case in its own disposable data directory, plus SQLite-specific cases.

import { describeStoragePortContract } from "./port-contract";
import { openStore } from "./sqlite-harness";

describeStoragePortContract("desktop SQLite adapter", () => openStore());
