import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";

export async function node(
    nodeId: number,
    N: number,
    F: number,
    initialValue: Value,
    isFaulty: boolean,
    nodesAreReady: () => boolean,
    setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  let killed = false;
  let decisionBroadcasted = false;
  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let receivedMessages: { x: Value; k: number; final?: boolean }[] = [];

  async function sendMessage(toNode: number, message: { x: Value; k: number; final?: boolean }) {
    if (killed || isFaulty) return;
    try {
      await fetch(`http://localhost:${BASE_NODE_PORT + toNode}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
    } catch (error) {
      console.error(`Node ${nodeId} failed to send to ${toNode}:`, error);
    }
  }

  async function broadcastDecision() {
    if (decisionBroadcasted || isFaulty) return;
    decisionBroadcasted = true;
    const message = { x: state.x!, k: state.k!, final: true };
    receivedMessages.push(message);
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) await sendMessage(i, message);
    }
  }

  async function broadcastMessage() {
    if (isFaulty) return;
    const message = { x: state.x!, k: state.k! };
    receivedMessages.push(message);
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) await sendMessage(i, message);
    }
  }

  async function processRound() {
    if (killed || state.decided || isFaulty) return;

    const currentRound = state.k!;

    const finalMessage = receivedMessages.find(m => m.final);
    if (finalMessage) {
      state.x = finalMessage.x;
      state.decided = true;
      await broadcastDecision();
      return;
    }

    const roundMessages = receivedMessages.filter(m => m.k === currentRound);
    const requiredMessages = N - F;

    if (roundMessages.length < requiredMessages) return;

    const count0 = roundMessages.filter(m => m.x === 0).length;
    const count1 = roundMessages.filter(m => m.x === 1).length;
    const majorityThreshold = Math.floor(requiredMessages / 2) + 1;

    if (N > 2 * F) {
      if (count0 >= majorityThreshold) {
        state.x = 0;
        state.decided = true;
      } else if (count1 >= majorityThreshold) {
        state.x = 1;
        state.decided = true;
      } else {
        state.x = Math.random() < 0.5 ? 0 : 1;
      }
    } else {
      state.x = Math.random() < 0.5 ? 0 : 1;
      state.decided = false;
    }

    receivedMessages = receivedMessages.filter(m => m.k !== currentRound);

    if (state.decided) {
      await broadcastDecision();
    } else {
      state.k!++;
      broadcastMessage();
    }
  }

  function scheduleRound() {
    if (state.decided || killed) return;
    processRound().then(() => setTimeout(scheduleRound, 50));
  }

  app.get("/status", (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
  });

  app.get("/getState", (req, res) => {
    res.json(state);
  });

  // @ts-ignore
  app.post("/message", async (req, res) => {
    if (killed || isFaulty) return res.status(400).send("Node unavailable");
    const { x, k, final } = req.body;
    if (typeof x === 'number' && typeof k === 'number') {
      // @ts-ignore
      receivedMessages.push({ x, k, final });
      await processRound();
    }
    res.status(200).send("Message processed");
  });

  // @ts-ignore
  app.get("/start", async (req, res) => {
    if (killed || isFaulty || !nodesAreReady()) return res.status(400).send("Can't start");
    if (N === 1) {
      state.decided = true;
      return res.send("Decided immediately");
    }
    broadcastMessage();
    scheduleRound();
    res.send("Consensus initiated");
  });

  app.get("/stop", async (req, res) => {
    killed = true;
    state.killed = true;
    res.send("Node halted");
  });

  return app.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} active on ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });
}