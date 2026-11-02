import express from "express";
import { readConfig } from "./server/config.js";
import { createPool } from "./server/database.js";
import { createApp } from "./server/app.js";

const config = readConfig();
const pool = createPool(config.databaseUrl);

export default createApp(pool, config, express());
