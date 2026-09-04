module.exports = {
  apps: [
    {
      name: "sukjmart",
      script: "./server.js",
      autorestart: true,
      watch: false
    },
    {
      name: "ai-agent-runner",
      script: "./aiAgentRunner.js",
      autorestart: true,
      watch: false
    }
  ]
};
