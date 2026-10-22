"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardHeader, Status } from "../../components/dashboard";
import { Icon } from "../../components/brand";
import {
  isInitialContentLoad,
  SkeletonCollection,
} from "../../components/Skeletons";
import { formatCampusDate } from "../../lib/date";
import type { MarketplaceOrder } from "../../types";
import { WebOrderWorkspace } from "./WebOrderWorkspace";

type OrderFilter = "all" | "active" | "completed";

const completedStatuses = new Set(["COMPLETED", "REJECTED", "CANCELLED"]);
const ordersPerPage = 6;

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
  loadingMore,
  hasMore,
  loadMore,
  refresh,
  openOrderId,
  onOrderOpened,
}: {
  token: string;
  orders: MarketplaceOrder[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  openOrderId?: string | null;
  onOrderOpened?: () => void;
}) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [page, setPage] = useState(1);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [refreshCycle, setRefreshCycle] = useState(0);
  const [hasRefreshed, setHasRefreshed] = useState(false);
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
  const pageCount = Math.max(
    1,
    Math.ceil(visibleOrders.length / ordersPerPage),
  );
  const paginatedOrders = useMemo(
    () => visibleOrders.slice((page - 1) * ordersPerPage, page * ordersPerPage),
    [page, visibleOrders],
  );

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (!openOrderId) return;
    const selected = orders.find((order) => order.id === openOrderId);
    if (selected) {
      setWorkspaceOrder(selected);
      onOrderOpened?.();
    }
  }, [onOrderOpened, openOrderId, orders]);

  const handleRefresh = async () => {
    if (loading || manualRefreshing) return;
    setManualRefreshing(true);
    setHasRefreshed(false);
    try {
      await refresh();
      setRefreshCycle((current) => current + 1);
      setHasRefreshed(true);
    } finally {
      setManualRefreshing(false);
    }
  };

  const isRefreshing = loading || manualRefreshing;

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
          className={`orders-refresh${manualRefreshing ? " is-refreshing" : ""}${hasRefreshed ? " is-refreshed" : ""}`}
          disabled={isRefreshing}
          onClick={() => void handleRefresh()}
          aria-label={isRefreshing ? "Refreshing orders" : "Refresh orders"}
        >
          <Icon name="refresh" />
          <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>
      <div
        className={`table-card client-orders-table${manualRefreshing ? " is-refreshing" : ""}${hasRefreshed ? " is-refreshed" : ""}`}
        aria-busy={manualRefreshing}
        data-refresh-cycle={refreshCycle}
      >
        <div className="table-head">
          <span>Order</span>
          <span>Provider</span>
          <span>Amount</span>
          <span>Due date</span>
          <span>Status</span>
          <span />
        </div>
        {paginatedOrders.map((order, index) => (
          <div
            className="table-row"
            key={`${order.id}-${refreshCycle}`}
            style={{ animationDelay: `${Math.min(index * 45, 225)}ms` }}
          >
            <span data-label="Order">
              <b>{order.title}</b>
              <small>{order.orderNumber}</small>
            </span>
            <span data-label="Provider">{order.provider.displayName}</span>
            <span data-label="Amount">
              <b>{formatMoney(order.totalCentavos, order.currency)}</b>
            </span>
            <span data-label="Deadline">
              <small>
                {!order.dueAt
                  ? "Deadline"
                  : order.status === "REQUESTED"
                    ? "Requested delivery"
                    : "Due"}
              </small>
              <b>
                {order.dueAt
                  ? formatCampusDate(order.dueAt)
                  : "Starts after payment"}
              </b>
            </span>
            <span data-label="Status">
              <Status label={order.status} />
            </span>
            <span className="table-row-action">
              <button
                className="row-button"
                onClick={() => setWorkspaceOrder(order)}
              >
                Open workspace →
              </button>
            </span>
          </div>
        ))}
        <span className="sr-only" aria-live="polite">
          {manualRefreshing
            ? "Refreshing orders"
            : hasRefreshed
              ? "Orders refreshed"
              : ""}
        </span>
        {isInitialContentLoad(loading, orders.length) && (
          <SkeletonCollection kind="order" label="Loading your orders" />
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
      {visibleOrders.length > ordersPerPage && (
        <div
          className="orders-pagination"
          role="navigation"
          aria-label="My orders pages"
        >
          <span className="orders-page-summary">
            Showing {(page - 1) * ordersPerPage + 1}–
            {Math.min(page * ordersPerPage, visibleOrders.length)} of{" "}
            {visibleOrders.length}
          </span>
          <div>
            <button
              type="button"
              aria-label="Previous orders page"
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              ‹
            </button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(
              (pageNumber) => (
                <button
                  type="button"
                  key={pageNumber}
                  className={page === pageNumber ? "active" : ""}
                  aria-label={`Open orders page ${pageNumber}`}
                  aria-current={page === pageNumber ? "page" : undefined}
                  onClick={() => setPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ),
            )}
            <button
              type="button"
              aria-label="Next orders page"
              disabled={page === pageCount}
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
            >
              ›
            </button>
          </div>
        </div>
      )}
      {hasMore && (
        <div className="orders-pagination">
          <button
            type="button"
            className="outline-action"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading more orders..." : "Load more orders"}
          </button>
        </div>
      )}
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
