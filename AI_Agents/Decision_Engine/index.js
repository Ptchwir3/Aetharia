// AI_Agents/decision-engine/index.js

function decideAction(context) {
  const { player, environment } = context;

  // Placeholder logic — future GPT prompt or behavior tree
  if (environment.threats && environment.threats.length > 0) {
    return "evade";
  }

  return "patrol";
}

module.exports = { decideAction };
