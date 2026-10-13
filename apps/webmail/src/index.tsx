import { render } from "solid-js/web";
import App from "./App";
import "./app.css";
import "highlight.js/styles/github.css";

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
