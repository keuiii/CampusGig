"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardHeader, Status } from "../../components/dashboard";
import type { MarketplaceOrder } from "../../types";
import { WebOrderWorkspace } from "./WebOrderWorkspace";

type OrderFilter = "all" | "active" | "completed";

const completedStatuses = new Set(["COMPLETED", "REJECTED", "CANCELLED"]);

function formatMoney(centavos: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: currency || "PHP",
    maximumFractionDigits: 2,
  }).format(centavos / 100);
}

export function OrdersView({
  token,
  orders,
  loading,
  refresh,
  openOrderId,
  onOrderOpened,
}: {
  token: string;
  orders: MarketplaceOrder[];
  loading: boolean;
  refresh: () => Promise<void>;
  openOrderId?: string | null;
  onOrderOpened?: () => void;
}) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [workspaceOrder, setWorkspaceOrder] = useState<MarketplaceOrder | null>(
    null,
  );

  const activeCount = orders.filter(
    (order) => !completedStatuses.has(order.status),
  ).length;
  const completedCount = orders.filter(
    (order) => order.status === "COMPLETED",
  ).length;
  const visibleOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (filter === "active") return !completedStatuses.has(order.status);
        if (filter === "completed") return order.status === "COMPLETED";
        return true;
      }),
    [filter, orders],
  );

  useEffect(() => {
    if (!openOrderId) return;
    const selected = orders.find((order) => order.id === openOrderId);
    if (selected) {
      setWorkspaceOrder(selected);
      onOrderOpened?.();
    }
  }, [onOrderOpened, openOrderId, orders]);

  return (
    <main className="dashboard-page">
      <DashboardHeader
        kicker="MY PROJECTS"
        title="My orders"
        subtitle="Track your bookings, review deliveries, and keep every project moving."
      />
      <div className="filter-tabs" role="tablist" aria-label="Order filters">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          All orders <span>{orders.length}</span>
        </button>
        <button
          className={filter === "active" ? "active" : ""}
          onClick={() => setFilter("active")}
        >
          Active <span>{activeCount}</span>
        </button>
        <button
          className={filter === "completed" ? "active" : ""}
          onClick={() => setFilter("completed")}
        >
          Completed <span>{completedCount}</span>
        </button>
        <button
          className="orders-refresh"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="table-card client-orders-table">
        <div className="table-head">
          <span>Order</span>
          <span>Provider</span>
          <span>Amount</span>
          <span>Due date</span>
          <span>Status</span>
          <span />
        </div>
        {visibleOrders.map((order) => (
          <div className="table-row" key={order.id}>
            <span>
              <b>{order.title}</b>
              <small>{order.orderNumber}</small>
            </span>
            <span>{order.provider.displayName}</span>
            <span>
              <b>{formatMoney(order.totalCentavos, order.currency)}</b>
            </span>
            <span>{new Date(order.dueAt).toLocaleDateString()}</span>
            <span>
              <Status label={order.status.replaceAll("_", " ")} />
            </span>
            <span>
              <button
                className="row-button"
                onClick={() => setWorkspaceOrder(order)}
              >
                Open workspace →
              </button>
            </span>
          </div>
        ))}
        {loading && orders.length === 0 && (
          <div className="empty compact">
            <span>◌</span>
            <h3>Loading your orders</h3>
            <p>Connecting to your CampusGig projects…</p>
          </div>
        )}
        {!loading && visibleOrders.length === 0 && (
          <div className="empty compact">
            <span>◇</span>
            <h3>{orders.length ? "No matching orders" : "No orders yet"}</h3>
            <p>
              {orders.length
                ? "Choose another filter to see your other projects."
                : "Bookings will appear here after you request a service."}
            </p>
          </div>
        )}
      </div>
      {workspaceOrder && (
        <WebOrderWorkspace
          token={token}
          order={workspaceOrder}
          perspective="client"
          onClose={() => setWorkspaceOrder(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}
