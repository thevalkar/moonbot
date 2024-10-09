--
-- PostgreSQL database dump
--

-- Dumped from database version 14.13 (Homebrew)
-- Dumped by pg_dump version 14.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: moonbot_invite_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.moonbot_invite_codes (
    code character varying(64),
    keypair character varying(255),
    for_user character varying(64),
    enabled boolean DEFAULT false NOT NULL
);


ALTER TABLE public.moonbot_invite_codes OWNER TO postgres;

--
-- Name: pairs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pairs (
    address character varying(80) NOT NULL,
    source character varying(32),
    token_mint character varying(80),
    data jsonb
);


ALTER TABLE public.pairs OWNER TO postgres;

--
-- Name: pool_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pool_addresses (
    token character varying(80),
    pool_address character varying(80)
);


ALTER TABLE public.pool_addresses OWNER TO postgres;

--
-- Name: signal_token_prices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.signal_token_prices (
    token_mint character varying(80),
    price double precision,
    "timestamp" bigint,
    token_amount double precision,
    sol_amount double precision,
    txid character varying
);


ALTER TABLE public.signal_token_prices OWNER TO postgres;

--
-- Name: token_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.token_entries (
    token_mint character varying(80) NOT NULL,
    price double precision,
    buyer character varying(80),
    "timestamp" bigint,
    source character varying(80),
    token_insights jsonb,
    amount double precision
);


ALTER TABLE public.token_entries OWNER TO postgres;

--
-- Name: token_price; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.token_price (
    token_mint character varying(80),
    price double precision,
    updated_timestamp character varying(80)
);


ALTER TABLE public.token_price OWNER TO postgres;

--
-- Name: token_prices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.token_prices (
    token_mint character varying(80),
    price double precision,
    "timestamp" bigint
);


ALTER TABLE public.token_prices OWNER TO postgres;

--
-- Name: token_signals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.token_signals (
    token_mint character varying(80),
    pair_address character varying(80),
    price double precision,
    source character varying(80),
    "timestamp" bigint,
    buyers integer,
    amount double precision,
    buyer character varying(80)
);


ALTER TABLE public.token_signals OWNER TO postgres;

--
-- Name: tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tokens (
    mint character varying(80) NOT NULL,
    data jsonb,
    pair_address character varying(80)
);


ALTER TABLE public.tokens OWNER TO postgres;

--
-- Name: user_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_config (
    discordid character varying(80) NOT NULL,
    strategy character varying(80),
    entry double precision,
    min_times_bought integer
);


ALTER TABLE public.user_config OWNER TO postgres;

--
-- Name: pairs pairs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pairs
    ADD CONSTRAINT pairs_pkey PRIMARY KEY (address);


--
-- Name: token_price token_price_token_mint_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.token_price
    ADD CONSTRAINT token_price_token_mint_key UNIQUE (token_mint);


--
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (mint);


--
-- Name: moonbot_invite_codes uq_code; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moonbot_invite_codes
    ADD CONSTRAINT uq_code UNIQUE (code);


--
-- Name: user_config user_config_discordid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_config
    ADD CONSTRAINT user_config_discordid_key UNIQUE (discordid);


--
-- Name: idx_token_mint_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_token_mint_timestamp ON public.token_prices USING btree (token_mint, "timestamp");


--
-- Name: idx_token_prices_token_mint_price_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_token_prices_token_mint_price_timestamp ON public.token_prices USING btree (token_mint, price, "timestamp");


--
-- Name: ixs_token_buyers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ixs_token_buyers ON public.token_signals USING btree (token_mint, buyers);


--
-- Name: pairs pair_token_mint; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pairs
    ADD CONSTRAINT pair_token_mint FOREIGN KEY (token_mint) REFERENCES public.tokens(mint);


--
-- Name: token_price price_token_mint; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.token_price
    ADD CONSTRAINT price_token_mint FOREIGN KEY (token_mint) REFERENCES public.tokens(mint);


--
-- PostgreSQL database dump complete
--

