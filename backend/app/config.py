from pydantic_settings import BaseSettings
from pathlib import Path


# Defaults that should NEVER appear in production. The lifespan check warns
# loudly if any of these are still in effect at startup.
_WEAK_DEFAULTS = {
    "secret_key": "changeme-replace-in-production",
    "admin_password": "admin1234",
}


class Settings(BaseSettings):
    # ── LLM routing ───────────────────────────────────────────────────────
    # Within a tier: round-robin / pinned-by-user / weighted
    llm_routing: str = "round-robin"

    # Per-operation tier selection. Each can be:
    #   "cheap"   → only consider providers tagged tier=cheap
    #   "premium" → only consider providers tagged tier=premium
    #   "auto"    → heuristic: short/simple queries → cheap, complex → premium
    route_query: str = "auto"
    route_ingest: str = "premium"
    route_reflect: str = "premium"
    route_lint: str = "cheap"

    # Anthropic — defaults to premium
    anthropic_enabled: bool = True
    anthropic_api_key: str = ""
    anthropic_base_url: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_max_concurrent: int = 6
    anthropic_weight: int = 1
    anthropic_tier: str = "premium"

    # OpenAI — defaults to premium (GPT-4 class)
    openai_enabled: bool = False
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o"
    openai_max_concurrent: int = 6
    openai_weight: int = 1
    openai_tier: str = "premium"

    # Gemini — defaults to cheap (Flash family)
    gemini_enabled: bool = False
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_max_concurrent: int = 6
    gemini_weight: int = 1
    gemini_tier: str = "cheap"

    secret_key: str = _WEAK_DEFAULTS["secret_key"]
    admin_username: str = "admin"
    admin_password: str = _WEAK_DEFAULTS["admin_password"]
    wiki_data_dir: Path = Path("/data")
    git_remote: str = ""
    cors_origins: str = "http://localhost:3000"

    # When true, set Secure flag on auth cookies (only works over HTTPS).
    # Default true — production runs behind nginx with TLS. For local HTTP
    # development override with COOKIE_SECURE=false in .env.
    cookie_secure: bool = True

    ocr_service_url: str = ""
    ocr_container_name: str = "smartledger-paddleocr"

    # ── Active Directory (optional) ───────────────────────────────────────
    # When AD_ENABLED is false (default), only local password accounts can log in.
    # When true, accounts with auth_source="ad" are authenticated via LDAP bind.
    ad_enabled: bool = False
    ad_host: str = ""                # e.g. "dc1.corp.local"
    ad_port: int = 636
    ad_use_ssl: bool = True
    ad_base_dn: str = ""             # e.g. "DC=corp,DC=local"
    # How to format the bind username. One of:
    #   "upn"     → username@<ad_upn_suffix>      e.g. john@corp.local
    #   "ntlm"    → <ad_netbios>\username        e.g. CORP\john
    #   "dn"      → CN=username,<ad_user_dn_suffix>
    ad_bind_format: str = "upn"
    ad_upn_suffix: str = ""          # for upn:  "corp.local"
    ad_netbios: str = ""             # for ntlm: "CORP"
    ad_user_dn_suffix: str = ""      # for dn:   "OU=Users,DC=corp,DC=local"
    ad_connect_timeout_sec: int = 5

    @property
    def wiki_dir(self) -> Path:
        return self.wiki_data_dir / "wiki"

    @property
    def raw_dir(self) -> Path:
        return self.wiki_data_dir / "raw"

    @property
    def users_file(self) -> Path:
        return self.wiki_data_dir / "users.json"

    @property
    def audit_db(self) -> Path:
        return self.wiki_data_dir / "audit.db"

    @property
    def jobs_dir(self) -> Path:
        return self.wiki_data_dir / "jobs"

    def weak_defaults_in_use(self) -> list[str]:
        """Return names of settings still using their default insecure values."""
        bad: list[str] = []
        for k, v in _WEAK_DEFAULTS.items():
            if getattr(self, k) == v:
                bad.append(k.upper())
        if not self.anthropic_api_key:
            bad.append("ANTHROPIC_API_KEY (empty)")
        return bad

    class Config:
        env_file = ".env"


settings = Settings()
