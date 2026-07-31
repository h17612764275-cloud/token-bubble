import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DesignPlayground } from "./components/DesignPlayground";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{["designer", "shot"].some((key) => new URLSearchParams(window.location.search).has(key)) ? <DesignPlayground /> : <App />}</React.StrictMode>,
);
