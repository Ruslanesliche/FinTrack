import { Chart, registerables } from "chart.js";
import { createIcons, icons } from "lucide";

Chart.register(...registerables);
globalThis.Chart = Chart;
globalThis.lucide = { createIcons, icons };
