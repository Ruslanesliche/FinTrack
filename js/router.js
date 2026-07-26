const routes = [
  ["dashboard", /^#\/dashboard\/?$/],
  ["transactions", /^#\/transactions\/?$/],
  ["transaction", /^#\/transaction\/(new|edit\/([^/]+))\/?$/],
  ["analytics", /^#\/analytics\/?$/],
  ["budgets", /^#\/budgets\/?$/],
  ["goals", /^#\/goals\/?$/],
  ["debts", /^#\/debts\/?$/],
  ["categories", /^#\/categories\/?$/],
  ["settings", /^#\/settings\/?$/],
  ["backup", /^#\/backup\/?$/],
  ["about", /^#\/about\/?$/],
  ["more", /^#\/more\/?$/],
];

export function parseRoute(hash = location.hash) {
  for (const [name, expression] of routes) {
    const match = hash.match(expression);
    if (match) return { name, params: match.slice(1), hash };
  }
  return { name: "notFound", params: [], hash };
}

export function navigate(path) {
  location.hash = path.startsWith("#") ? path.slice(1) : path;
}

export function startRouter(render) {
  const onRoute = () => render(parseRoute());
  addEventListener("hashchange", onRoute);
  if (!location.hash) location.replace("#/dashboard");
  else onRoute();
}
