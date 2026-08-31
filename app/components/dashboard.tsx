import type { ReactNode } from "react";
import { Logo } from "./brand";

export function DashboardHeader({
  kicker,
  title,
  subtitle,
  action,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="dashboard-header">
      <div>
        <span className="kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  change,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  icon: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{change}</span>
      </div>
      <i>{icon}</i>
    </div>
  );
}

export function Status({ label }: { label: string }) {
  return (
    <span className={`status ${label.toLowerCase().replace(" ", "-")}`}>
      {label}
    </span>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="footer-inner">
        <Logo />
        <p>
          Student skills. Real opportunities.
          <br />
          Built for the schools of Lipa City.
        </p>
        <div>
          <b>Marketplace</b>
          <a>Browse services</a>
          <a>Become a provider</a>
        </div>
        <div>
          <b>CampusGig</b>
          <a>About us</a>
          <a>Community guidelines</a>
        </div>
        <div>
          <b>Support</b>
          <a>Help center</a>
          <a>Contact us</a>
        </div>
      </div>
      <div className="copyright">
        © 2026 CampusGig · A student capstone project
      </div>
    </footer>
  );
}
