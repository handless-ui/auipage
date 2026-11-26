import testjs from "@oipage/testjs";
const { Unit } = testjs;

const { describe, it, expect } = Unit.node();

import modelUnit from "./model.unit.js";
modelUnit({ describe, it, expect });

import fetchUnit from "./fetch.unit.js";
fetchUnit({ describe, it, expect });

import agentUnit from "./agent.unit.js";
agentUnit({ describe, it, expect });

import agentFlowUnit from "./agent-flow.unit.js";
agentFlowUnit({ describe, it, expect });

import coreUnit from "./core.unit.js";
coreUnit({ describe, it, expect });

import coreFlowUnit from "./core-flow.unit.js";
coreFlowUnit({ describe, it, expect });
