export const backendOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "WB Automation Backend API",
    version: "0.1.0"
  },
  tags: [
    { name: "Health", description: "Service health endpoints" },
    { name: "Shops", description: "Shop management endpoints" },
    { name: "Flows", description: "Automation flow endpoints" }
  ]
};
