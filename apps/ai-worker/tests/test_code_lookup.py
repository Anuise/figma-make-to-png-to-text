from ai_worker.code_lookup import find_code_snippet


def test_finds_a_matching_page_file(tmp_path):
    pages = tmp_path / "src" / "pages"
    pages.mkdir(parents=True)
    (pages / "checkout.tsx").write_text(
        "export default function Checkout() {\n  return <div>Checkout</div>;\n}\n",
        encoding="utf-8",
    )

    snippet = find_code_snippet(tmp_path, "/checkout")
    assert snippet is not None
    assert "Checkout" in snippet


def test_returns_none_without_blocking_when_nothing_matches(tmp_path):
    pages = tmp_path / "src" / "pages"
    pages.mkdir(parents=True)
    (pages / "home.tsx").write_text("export default function Home() {}\n", encoding="utf-8")

    assert find_code_snippet(tmp_path, "/checkout") is None


def test_never_reads_a_denylisted_file_even_if_the_route_matches(tmp_path):
    pages = tmp_path / "src" / "pages"
    pages.mkdir(parents=True)
    (pages / "checkout.env").write_text("SECRET=do-not-leak", encoding="utf-8")

    assert find_code_snippet(tmp_path, "/checkout") is None


def test_never_descends_into_node_modules(tmp_path):
    node_modules_checkout = tmp_path / "src" / "node_modules" / "checkout-lib"
    node_modules_checkout.mkdir(parents=True)
    (node_modules_checkout / "index.js").write_text("module.exports = {};\n", encoding="utf-8")

    assert find_code_snippet(tmp_path, "/checkout") is None
