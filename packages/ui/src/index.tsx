import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";
import "./design/tokens.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Root element #app not found");
}

render(() => <App />, root);
