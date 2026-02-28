import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import BlogPage from "./blog/BlogPage";
import "./styles.css";

const path = window.location.pathname.replace(/\/+$/, "");
const isBlogRoute = path === "/blog" || path.startsWith("/blog/");
const Root = isBlogRoute ? BlogPage : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
