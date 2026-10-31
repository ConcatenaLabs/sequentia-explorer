import { getSupply } from "../lib/elements.js";
import { nativeAssetId, nativeAssetLabel, nativeAssetName } from "../const";
import layout from "./layout";
import loader from "../components/loading";

// Resolve a display label for an asset. electrs has no curated registry on
// Sequentia, so issued assets carry no name/ticker — fall back to the static
// asset map ([domain, ticker, name, precision] keyed by asset id) and the
// configured native-asset label.
const resolveLabel = (asset, assetMap) => {
  const [domain, ticker, name] = (assetMap && assetMap[asset.asset_id]) || [];
  const isNative = asset.asset_id === nativeAssetId;
  return {
    name: asset.name || name || (isNative ? nativeAssetName : null),
    ticker: asset.ticker || ticker || (isNative ? nativeAssetLabel : null),
    domain: (asset.entity && asset.entity.domain) || domain || null,
  };
};
import {
  CurrencyDollarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon
} from "../components/icons";

const staticRoot = process.env.STATIC_ROOT || "";

// The registered assets (those the registry names), by ticker: the ones a
// visitor looks for, listed above the chain's full list on its first page.
const registeredAssets = (assetMap) =>
  Object.entries(assetMap || {})
    .filter(([, [, ticker, name] = []]) => ticker || name)
    .map(([asset_id, [domain, ticker, name]]) => ({ asset_id, domain, ticker, name }))
    .sort((a, b) => String(a.ticker || a.name).localeCompare(String(b.ticker || b.name)));

// An asset the registry does not name and of which one unit was issued (a
// token a contract or an order made for itself): folded on the full list.
const isUnnamedSingle = (asset, label) =>
  !label.name && !label.ticker && asset.chain_stats && asset.chain_stats.issued_amount === 1;

const dash = <span className="asset-list-none">—</span>;

const assetRow = (asset_id, label, supply, t) => (
  <a href={`asset/${asset_id}`}>
  <div className="assets-table-link-row">
    <div className="assets-table-row">
      <div className="asset-list-name" data-label={t`Name`}>
        <CurrencyDollarIcon className="currency-dollar" />
        {label.name || <span className="mono">{asset_id.substring(0, 12)}…</span>}
      </div>
      <div className="asset-list-ticker" data-label={t`Ticker`}>
        {label.ticker || dash}
      </div>
      <div className="asset-list-total-supply" data-label={t`Total Supply`}>
        {supply}
      </div>
      <div className="asset-list-issuer-domain" data-label={t`Issuer domain`}>
        {label.domain || dash}
      </div>
    </div>
  </div>
  </a>
);
export default ({ assetList, goAssetList, loading, t, assetMap, ...S }) => {
  const { assets, total } = assetList || {};
  const { start_index, sort_dir, sort_field, limit } = goAssetList;
  const pageLink = `assets?sort_field=${encodeURIComponent(sort_field)}&sort_dir=${encodeURIComponent(sort_dir)}`;
  const reverseSortDir = encodeURIComponent(
    sort_dir === "asc" ? "desc" : "asc",
  );

  return layout(
    <div key="assets">
      <div className="container">
        {!assets ? (
          <div className="load-more-container">{loader()}</div>
        ) : !assets.length ? (
          <div className="asset-container">
            <p>{t`No registered assets`}</p>
          </div>
        ) : (
          <div className="asset-container">
            <div className="table-header">
              <div className="table-header-icon-container">
                <CurrencyDollarIcon />
              </div>
              <h1 className="table-header-title">All Assets</h1>
            </div>

            {start_index === 0 && registeredAssets(assetMap).length ? (
              <div className="asset-list-registered">
                <h2 className="asset-list-section">{t`Registered assets`}</h2>
                {titleRow({ sort_field, sort_dir, reverseSortDir }, false)}
                <div className="asset-list-body">
                  {registeredAssets(assetMap).map((r) => assetRow(r.asset_id, r, "", t))}
                </div>
                <h2 className="asset-list-section">{t`Every asset on the chain`}</h2>
              </div>
            ) : ""}

            {titleRow({ sort_field, sort_dir, reverseSortDir }, true)}

            <div className={`asset-list-body ${loading ? "asset-list-body-loading" : ""}`}>
              {assets.filter((asset) => !isUnnamedSingle(asset, resolveLabel(asset, assetMap)))
                .map((asset) => assetRow(asset.asset_id, resolveLabel(asset, assetMap), getSupply(asset, t), t))}
              {(() => {
                const folded = assets.filter((asset) => isUnnamedSingle(asset, resolveLabel(asset, assetMap)));
                return folded.length ? (
                  <details className="asset-list-folded">
                    <summary>{folded.length === 1 ? t`1 unnamed single-unit asset on this page` : `${folded.length} ${t`unnamed single-unit assets on this page`}`}</summary>
                    {folded.map((asset) => assetRow(asset.asset_id, resolveLabel(asset, assetMap), getSupply(asset, t), t))}
                  </details>
                ) : "";
              })()}
            </div>
            <div className="asset-list-footer">
              {paginationControls(total, start_index, limit, pageLink)}
            </div>
          </div>
        )}
      </div>
    </div>,
    { assetList, activeTab: "assets", t, ...S },
  );
};

// The column titles; `sortable` false for the registered list, which keeps its own order.
const titleRow = (sort, sortable) => (
  <div className="table-title-row">
    {sortHeader("NAME", sortable ? "name" : null, "asset-list-name", sort)}
    {sortHeader("TICKER", sortable ? "ticker" : null, "asset-list-ticker", sort)}
    {sortHeader("TOTAL SUPPLY", null, "asset-list-total-supply", sort)}
    {sortHeader("ISSUER DOMAIN", sortable ? "domain" : null, "asset-list-issuer-domain", sort)}
  </div>
);

const sortHeader = (label, field, className, { sort_field, sort_dir, reverseSortDir }) => {
  if (!field) {
    return <p className={className}>{label}</p>;
  }

  const isActive = sort_field === field;
  const sortIcon = <span className={`asset-sort-icon ${!isActive ? "asset-sort-icon-inactive" : ""}`} aria-hidden="true">
    <ChevronUpIcon className={sort_field === field && sort_dir === "desc" ? "asset-sort-chevron-muted" : ""} />
    <ChevronDownIcon className={sort_field === field && sort_dir === "asc" ? "asset-sort-chevron-muted" : ""} />
  </span>;

  return <a className={className} href={`assets?sort_field=${field}&sort_dir=${reverseSortDir}`}>{label} {sortIcon}</a>;
};

const paginationControls = (total, startIndex, limit, pageLink) => {
  const maxVisibleButtons = 5,
    totalPage = Math.ceil(total / limit),
    curPage = startIndex / limit + 1,
    lastPage = limit * (totalPage - 1),
    currentStart = startIndex + 1,
    currentEnd = Math.min(startIndex + limit, total);

  let maxLeft = curPage - Math.floor(maxVisibleButtons / 2);
  let maxRight = curPage + Math.floor(maxVisibleButtons / 2);

  if (maxLeft < 1) {
    maxLeft = 1;
    maxRight = maxVisibleButtons;
  }

  if (maxRight > totalPage) {
    maxLeft = totalPage - (maxVisibleButtons - 1);
    maxRight = totalPage;

    if (maxLeft < 1) {
      maxLeft = 1;
    }
  }

  const visiblePages = [];
  for (let pageNum = maxLeft; pageNum <= maxRight; pageNum++) {
    visiblePages.push(pageNum);
  }

  const pageRanges = [];
  for (let page = 0; page < totalPage; page++) {
    const pageStartIndex = page * limit,
      start = pageStartIndex + 1,
      end = Math.min(pageStartIndex + limit, total);

    pageRanges.push({ pageStartIndex, start, end });
  }

  const pagination = {
    total,
    limit,
    pageLink,
    startIndex,
    totalPage,
    lastPage,
    curPage,
    currentStart,
    currentEnd,
    pageRanges,
    visiblePages,
    prevDisabled: startIndex === 0,
    nextDisabled: startIndex + limit >= total,
  };

  return (
    <div className="asset-list-pagination">
      {paginationDropdown(pagination)}
      {paginationButtons(pagination)}
    </div>
  );
};

const paginationDropdown = ({
  total,
  pageLink,
  startIndex,
  currentStart,
  currentEnd,
  pageRanges,
}) => (
  <div className="pagination-dropdown-container">
    <p>Showing</p>
    <div className="pagination-dropdown" tabindex="0">
      <div className="pagination-dropdown-current">
        <span>{currentStart} - {currentEnd}</span>
        <ChevronDownIcon />
      </div>
      <div className="pagination-dropdown-options">
        {pageRanges.map(({ pageStartIndex, start, end }) => (
          <a
            className={`pagination-dropdown-option ${pageStartIndex === startIndex ? "current" : ""}`}
            href={`${pageLink}&start_index=${pageStartIndex}`}
          >
            {start} - {end}
          </a>
        ))}
      </div>
    </div>
    <p>of {total} results</p>
  </div>
);

const paginationButtons = ({
  limit,
  pageLink,
  start_index: startIndex,
  visiblePages,
  prevDisabled,
  nextDisabled,
}) => {

  return (
    <div className="pagination">
      <a
        className={`prev pagelink ${prevDisabled ? "prev-disabled" : ""}`}
        href={
          prevDisabled ? "#" : `${pageLink}&start_index=${startIndex - limit}`
        }
      >
        <ChevronLeftIcon />
        <p>Previous</p>
      </a>
      <div className="numbers">
        {visiblePages.map((pgNum) => {
          const pageStartIndex = limit * (pgNum - 1);
          return (
            <a
              href={`${pageLink}&start_index=${pageStartIndex}`}
              className={`pagelink ${pageStartIndex === startIndex ? "current" : ""} number`}
            >
              {pgNum}
            </a>
          );
        })}
      </div>
      <a
        className={`next pagelink ${nextDisabled ? "next-disabled" : ""}`}
        href={
          nextDisabled ? "#" : `${pageLink}&start_index=${startIndex + limit}`
        }
      >
        <p>Next</p>
        <ChevronRightIcon />
      </a>
    </div>
  );
};
