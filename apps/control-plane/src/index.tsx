import { render } from "solid-js/web";
import App from "./App";
import "./app.css";
import "./tours/tour_style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
render(() => <App />, root);
