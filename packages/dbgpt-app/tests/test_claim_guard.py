"""Regression checks for final claims exceeding SQL evidence."""

import json
import unittest
from types import SimpleNamespace

from dbgpt_app.openapi.api_v1.claim_guard import guard_final_claims


def sql_step(sql):
    return {"action": "sql_query", "status": "done",
            "action_input": json.dumps({"sql": sql})}


class ClaimGuardTest(unittest.TestCase):
    def test_cart_link_count_does_not_prove_addition_or_abandonment(self):
        answer = ("5.661 phiên có liên kết giỏ hàng.\n"
                  "Số lượng cao hơn checkout cho thấy nhiều người thêm vào giỏ nhưng không hoàn tất.\n"
                  "Các số này không chứng minh conversion tuần tự.")
        result, issues = guard_final_claims(
            answer, [sql_step("SELECT count(*) FROM funnelmetry_demo.cart_links")]
        )
        self.assertIn("5.661 phiên", result)
        self.assertNotIn("nhiều người thêm vào giỏ", result)
        self.assertIn("không chứng minh conversion", result)
        self.assertIn("cart_abandonment", issues)

    def test_payment_and_delivery_require_separate_source_queries(self):
        answer = "Đã thanh toán và đã giao hàng.\nCó 100 đơn ghi nhận."
        result, issues = guard_final_claims(answer, [sql_step("SELECT count(*) FROM orders")])
        self.assertNotIn("Đã thanh toán", result)
        self.assertIn("Có 100 đơn", result)
        self.assertEqual(issues, ["fulfillment_outcome", "payment_outcome"])

    def test_supported_payment_and_negative_limitations_remain(self):
        answer = "Đã thanh toán.\nKhông suy ra doanh thu đã thu từ trạng thái ON."
        result, issues = guard_final_claims(
            answer, [sql_step("SELECT count(*) FROM payment_actions WHERE action='CAPTURED'")]
        )
        self.assertIn(answer, result)
        self.assertEqual(issues, ["review_required:payment_outcome"])

    def test_scanning_payment_table_does_not_certify_capture(self):
        result, issues = guard_final_claims(
            "Đã thanh toán.", [sql_step("SELECT count(*) FROM payment_actions")]
        )
        self.assertIn("payment_outcome", issues)
        self.assertNotIn("Đã thanh toán", result)

    def test_knowledge_answers_are_not_treated_as_sql_claims(self):
        answer = "Bài viết mô tả doanh thu đã thu."
        steps = [{"action": "knowledge_retrieve", "status": "done"}]
        self.assertEqual(guard_final_claims(answer, steps), (answer, []))
        artifact = SimpleNamespace(
            type="reference", reference_type="knowledge", status="succeeded",
        )
        self.assertEqual(
            guard_final_claims(answer, [], artifacts=[artifact]), (answer, [])
        )

    def test_claim_without_any_evidence_is_removed(self):
        result, issues = guard_final_claims("Đã thanh toán 100 đơn.", [])
        self.assertIn("payment_outcome", issues)
        self.assertNotIn("Đã thanh toán", result)

    def test_causal_claim_requires_specific_evidence(self):
        result, issues = guard_final_claims(
            "Thay đổi giá gây ra tăng doanh số.",
            [sql_step("SELECT price, sales FROM monthly_summary")]
        )
        self.assertNotIn("gây ra", result)
        self.assertEqual(issues, ["causal_claim"])

    def test_other_business_claims_require_compatible_evidence(self):
        cases = [
            ("Tỷ lệ chuyển đổi đạt 10%.", "SELECT count(*) FROM sessions", "conversion_claim"),
            ("Khách quay lại tăng 20%.", "SELECT count(*) FROM orders", "retention_claim"),
            ("Tồn kho khả dụng là 50.", "SELECT stocked FROM inventory_level", "sellable_stock_claim"),
            ("Đã giao hàng 10 đơn.", "SELECT count(*) FROM fulfillment", "fulfillment_outcome"),
            ("Doanh thu sau hoàn tiền đạt 20.", "SELECT sum(total_amount) FROM orders", "refund_claim"),
            ("Facebook mang lại 30 đơn.", "SELECT count(*) FROM sessions WHERE utm_source='facebook'", "attribution_claim"),
        ]
        for answer, query, expected in cases:
            with self.subTest(answer=answer):
                result, issues = guard_final_claims(answer, [sql_step(query)])
                self.assertIn(expected, issues)
                self.assertNotIn(answer, result)

    def test_evidence_must_be_in_the_same_query(self):
        steps = [
            sql_step("SELECT count(*) FROM payment_actions"),
            sql_step("SELECT status FROM orders WHERE status='captured'"),
        ]
        _, issues = guard_final_claims("Đã thanh toán 100 đơn.", steps)
        self.assertIn("payment_outcome", issues)

    def test_confirmed_child_sql_artifact_is_used(self):
        artifact = SimpleNamespace(
            type="sql", status="succeeded",
            sql="SELECT count(*) FROM payment_actions WHERE action='CAPTURED'",
        )
        result, issues = guard_final_claims(
            "Đã thanh toán 100 đơn.", [], artifacts=[artifact]
        )
        self.assertIn("Đã thanh toán 100 đơn.", result)
        self.assertEqual(issues, ["review_required:payment_outcome"])

    def test_failed_sql_artifact_cannot_support_claim(self):
        artifact = SimpleNamespace(
            type="sql", status="failed",
            sql="SELECT count(*) FROM payment_actions WHERE action='CAPTURED'",
        )
        result, issues = guard_final_claims(
            "Đã thanh toán 100 đơn.", [], artifacts=[artifact]
        )
        self.assertIn("payment_outcome", issues)
        self.assertNotIn("Đã thanh toán", result)

    def test_caveat_after_positive_claim_does_not_hide_it(self):
        answer = "Đã thanh toán 100 đơn, nhưng không chứng minh các đơn được giao."
        result, issues = guard_final_claims(answer, [sql_step("SELECT count(*) FROM orders")])
        self.assertIn("payment_outcome", issues)
        self.assertNotIn("Đã thanh toán", result)

    def test_questions_hypotheses_and_explicit_uncertainty_remain(self):
        answer = (
            "Facebook mang lại 30 đơn?\n"
            "Nếu Facebook mang lại 30 đơn, ta cần kiểm tra attribution.\n"
            "Chưa xác nhận đã thanh toán 100 đơn."
        )
        self.assertEqual(guard_final_claims(answer, []), (answer, []))

    def test_negative_outcome_is_not_confused_with_a_caveat(self):
        answer = "Không hoàn tất checkout 500 phiên."
        result, issues = guard_final_claims(answer, [sql_step("SELECT count(*) FROM cart_links")])
        self.assertIn("cart_abandonment", issues)
        self.assertNotIn(answer, result)

    def test_separate_sentences_preserve_supported_measure(self):
        answer = "Có 5.661 cart link. Nhiều người thêm vào giỏ nhưng không hoàn tất."
        result, issues = guard_final_claims(answer, [sql_step("SELECT count(*) FROM cart_links")])
        self.assertIn("Có 5.661 cart link.", result)
        self.assertNotIn("Nhiều người thêm", result)
        self.assertIn("cart_abandonment", issues)

    def test_inference_after_comma_does_not_erase_count(self):
        answer = "Có 5.661 cart link, cho thấy nhiều khách bỏ giỏ.\nBước tiếp theo."
        result, issues = guard_final_claims(answer, [sql_step("SELECT count(*) FROM cart_links")])
        self.assertIn("Có 5.661 cart link\nBước tiếp theo.", result)
        self.assertNotIn("bỏ giỏ", result)
        self.assertIn("cart_abandonment", issues)

    def test_abandonment_signal_wording_is_blocked_but_observation_survives(self):
        answer = (
            "1. **2,241 sessions** have cart links but no checkout event "
            "→ This is a **session-level abandonment signal**, but does not "
            "prove customers added products.\n"
            "2. 8,720 ADD events are recorded."
        )
        result, issues = guard_final_claims(
            answer,
            [sql_step("SELECT count(*) FROM funnelmetry_demo.cart_links")],
        )
        self.assertIn("2,241 sessions", result)
        self.assertNotIn("abandonment signal", result)
        self.assertIn("8,720 ADD events", result)
        self.assertIn("cart_abandonment", issues)

    def test_dropoff_synonyms_require_cohort_evidence(self):
        for claim in (
            "The drop-off rate is 39.6%.",
            "This is cart abandonment.",
            "Đây là tín hiệu bỏ giỏ.",
        ):
            with self.subTest(claim=claim):
                result, issues = guard_final_claims(
                    claim, [sql_step("SELECT count(*) FROM cart_links")]
                )
                self.assertNotIn(claim, result)
                self.assertIn("cart_abandonment", issues)

    def test_assertive_heading_is_checked(self):
        result, issues = guard_final_claims(
            "## Facebook mang lại 50 đơn\nNội dung khác.",
            [sql_step("SELECT count(*) FROM sessions")],
        )
        self.assertIn("attribution_claim", issues)
        self.assertNotIn("Facebook mang lại", result)


class TraceRegressionTests(unittest.TestCase):
    def test_dataset_session_grain_requires_both_keys_in_query(self):
        answer = "Grain: (dataset_id, session_id).\nCount: 2,241 sessions."
        guarded, issues = guard_final_claims(
            answer, [sql_step("SELECT COUNT(DISTINCT session_id) FROM funnelmetry_demo.cart_links")]
        )
        self.assertIn("unsupported_grain", issues)
        self.assertNotIn("Grain:", guarded)
        self.assertIn("Count: 2,241 sessions", guarded)

    def test_verified_composite_grain_is_kept(self):
        answer = "Grain: (dataset_id, session_id)."
        guarded, issues = guard_final_claims(
            answer, [sql_step("SELECT COUNT(DISTINCT (dataset_id, session_id)) FROM funnelmetry_demo.cart_links")]
        )
        self.assertEqual((guarded, issues), (answer, []))

    def test_unverified_sql_proposal_is_retained_with_review_note(self):
        answer = (
            "Observed ON orders.\n```sql\nSELECT SUM(amount_minor) "
            "FROM funnelmetry_demo.payments WHERE action='CAPTURED';\n```"
        )
        guarded, issues = guard_final_claims(
            answer, [sql_step("SELECT COUNT(*) FROM funnelmetry_demo.orders")]
        )
        self.assertIn("unverified_sql_example", issues)
        self.assertIn("FROM funnelmetry_demo.payments", guarded)
        self.assertIn("SQL đề xuất được giữ nguyên", guarded)
        self.assertIn("Observed ON orders", guarded)


class ClaimScopeRegressionTests(unittest.TestCase):
    def test_bug14_original_conceptual_answer_is_unchanged(self):
        answer = (
            "Funnel thương mại điện tử là hành trình khách hàng từ tiếp cận đến mua hàng. "
            "Mỗi giai đoạn của funnel có tỷ lệ chuyển đổi riêng, giúp doanh nghiệp "
            "đo lường hiệu quả từng bước, phát hiện điểm nghẽn và tối ưu hóa trải nghiệm."
        )
        self.assertEqual(guard_final_claims(
            answer, [], request_text="Giải thích funnel thương mại điện tử trong 2 câu tiếng Việt.",
        ), (answer, []))

    def test_definitions_of_all_business_claim_families_need_no_sql(self):
        for answer in (
            "Funnel thường gồm xem sản phẩm, thêm vào giỏ và checkout.",
            "Bỏ giỏ là khái niệm mô tả giỏ hàng không được hoàn tất.",
            "Doanh thu đã thu là tổng số tiền được capture.",
            "Tồn kho khả dụng là số lượng có thể bán sau khi xét reservation.",
            "Tỷ lệ giữ chân được định nghĩa trên nhóm khách quay lại.",
            "Tỷ lệ chuyển đổi của shop được định nghĩa theo từng bước của funnel.",
            "Funnel gồm xem sản phẩm, thêm vào giỏ và checkout.",
            "Conversion rate is defined as the ratio between two stages.",
            "Cart abandonment typically refers to carts without completed checkout.",
            "The document describes captured revenue and fulfilled orders.",
        ):
            with self.subTest(answer=answer):
                self.assertEqual(guard_final_claims(answer, []), (answer, []))

    def test_context_allows_explanations_without_relaxing_measured_shop_claims(self):
        request = "Giải thích funnel và tỷ lệ chuyển đổi là gì."
        concept = "Tỷ lệ chuyển đổi giúp đánh giá hiệu quả giữa hai bước."
        self.assertEqual(guard_final_claims(concept, [], request_text=request), (concept, []))
        guarded, issues = guard_final_claims(
            concept + " Tỷ lệ chuyển đổi của shop là 12%.", [], request_text=request,
        )
        self.assertIn(concept, guarded)
        self.assertNotIn("của shop là 12%", guarded)
        self.assertIn("conversion_claim", issues)

    def test_analytical_explanation_request_is_not_a_blanket_exemption(self):
        answer = "Nhiều khách thêm vào giỏ nhưng không hoàn tất checkout."
        guarded, issues = guard_final_claims(
            answer, [], request_text="Phân tích dữ liệu và giải thích funnel của shop.",
        )
        self.assertNotIn(answer, guarded)
        self.assertIn("cart_abandonment", issues)

    def test_knowledge_actions_cannot_whitelist_unrelated_empirical_claim(self):
        for action in ("kb_ls", "kb_cat", "knowledge_retrieve"):
            with self.subTest(action=action):
                guarded, issues = guard_final_claims(
                    "Bài viết mô tả tỷ lệ chuyển đổi. Tỷ lệ chuyển đổi của shop là 12%.",
                    [{"action": action, "status": "done"}],
                )
                self.assertIn("Bài viết mô tả tỷ lệ chuyển đổi.", guarded)
                self.assertNotIn("của shop là 12%", guarded)
                self.assertIn("conversion_claim", issues)

    def test_knowledge_artifact_is_not_blanket_evidence_of_shop_outcomes(self):
        artifact = SimpleNamespace(type="reference", reference_type="knowledge", status="succeeded")
        guarded, issues = guard_final_claims(
            "Đã thanh toán 100 đơn.", [], artifacts=[artifact],
        )
        self.assertNotIn("Đã thanh toán 100 đơn", guarded)
        self.assertIn("payment_outcome", issues)

    def test_hypotheses_examples_and_recommendations_do_not_require_sql(self):
        for answer in (
            "Ví dụ: tỷ lệ chuyển đổi đạt 20% nếu 20 trên 100 phiên mua hàng.",
            "**Giả thuyết:** Thay đổi giá gây ra tăng doanh số.",
            "Đề xuất kiểm tra tỷ lệ giữ chân và khách quay lại theo cohort.",
            "Cần kiểm tra liệu Facebook mang lại 30 đơn hay không.",
            "For example, captured revenue could be 100 in a hypothetical dataset.",
        ):
            with self.subTest(answer=answer):
                self.assertEqual(guard_final_claims(answer, []), (answer, []))

    def test_following_fact_is_not_exempted_by_a_previous_hypothesis(self):
        answer = "Giả sử tỷ lệ chuyển đổi đạt 20%. Đã thanh toán 100 đơn."
        guarded, issues = guard_final_claims(answer, [])
        self.assertIn("Giả sử tỷ lệ chuyển đổi đạt 20%.", guarded)
        self.assertNotIn("Đã thanh toán 100 đơn", guarded)
        self.assertIn("payment_outcome", issues)

    def test_fact_after_hypothetical_clause_is_checked_independently(self):
        answer = "Giả sử tỷ lệ chuyển đổi đạt 20%, nhưng thực tế đã thanh toán 100 đơn."
        guarded, issues = guard_final_claims(answer, [])
        self.assertIn("Giả sử tỷ lệ chuyển đổi đạt 20%", guarded)
        self.assertNotIn("đã thanh toán 100 đơn", guarded)
        self.assertIn("payment_outcome", issues)

    def test_available_to_sell_is_not_mistaken_for_a_hypothesis(self):
        answer = "Có thể bán 50 sản phẩm."
        guarded, issues = guard_final_claims(answer, [])
        # The Vietnamese phrase is a stock outcome, not speculative 'may'.
        self.assertIn("sellable_stock_claim", issues)
        self.assertNotIn(answer, guarded)

    def test_custom_sql_is_not_rejected_for_using_different_source_names(self):
        answer = "Đã thanh toán 100 đơn."
        guarded, issues = guard_final_claims(answer, [sql_step(
            "SELECT confirmed_order_count FROM warehouse.settlement_metrics",
        )])
        self.assertIn(answer, guarded)
        self.assertEqual(issues, ["review_required:payment_outcome"])

    def test_python_result_is_preserved_for_review_without_requiring_sql(self):
        artifact = SimpleNamespace(type="python", status="succeeded", result={"paid_orders": 100})
        answer = "Đã thanh toán 100 đơn."
        guarded, issues = guard_final_claims(answer, [], artifacts=[artifact])
        self.assertIn(answer, guarded)
        self.assertEqual(issues, ["review_required:payment_outcome"])

    def test_retrieved_document_content_is_retained_under_review_not_certified(self):
        artifact = SimpleNamespace(type="reference", status="succeeded", excerpt="Source document excerpt")
        answer = "Đã thanh toán 100 đơn."
        guarded, issues = guard_final_claims(answer, [], artifacts=[artifact])
        self.assertIn(answer, guarded)
        self.assertEqual(issues, ["review_required:payment_outcome"])

    def test_ambiguous_interpretation_is_retained_and_marked_for_review(self):
        answer = "Tỷ lệ chuyển đổi phản ánh hiệu quả từng bước."
        guarded, issues = guard_final_claims(answer, [])
        self.assertIn(answer, guarded)
        self.assertIn("review_required:conversion_claim", issues)
        self.assertIn("được giữ lại để tham khảo", guarded)
        self.assertNotIn("đã được lược bỏ", guarded)

    def test_sql_keywords_are_not_certification_of_a_numeric_claim(self):
        # The query scope matches capture, but its text cannot prove a value of 100.
        answer = "Đã thanh toán 100 đơn."
        guarded, issues = guard_final_claims(answer, [sql_step(
            "SELECT count(*) FROM payment_actions WHERE action='CAPTURED'",
        )])
        self.assertIn(answer, guarded)
        self.assertEqual(issues, ["review_required:payment_outcome"])
        self.assertIn("không xem chúng là kết luận đã chứng nhận", guarded)

    def test_mixed_answer_preserves_concepts_proposals_and_observed_counts(self):
        answer = (
            "Funnel thường gồm xem sản phẩm, thêm vào giỏ và checkout.\n"
            "Có 5.661 phiên có liên kết giỏ hàng.\n"
            "Đề xuất phân tích thêm tỷ lệ chuyển đổi.\n"
            "Nhiều khách thêm vào giỏ nhưng không hoàn tất checkout."
        )
        guarded, issues = guard_final_claims(answer, [sql_step("SELECT count(*) FROM cart_links")])
        for retained in answer.splitlines()[:3]:
            self.assertIn(retained, guarded)
        self.assertNotIn(answer.splitlines()[3], guarded)
        self.assertIn("cart_abandonment", issues)

    def test_code_examples_are_preserved_verbatim_and_inputs_are_not_modified(self):
        steps = [sql_step("SELECT count(*) FROM sessions")]
        original_steps = json.dumps(steps, sort_keys=True)
        code = "```sql\nSELECT count(*) FROM proposed_source;\n```"
        guarded, issues = guard_final_claims("Ví dụ SQL:\n" + code, steps)
        self.assertIn(code, guarded)
        self.assertIn("unverified_sql_example", issues)
        self.assertEqual(json.dumps(steps, sort_keys=True), original_steps)

    def test_review_note_uses_response_language(self):
        answer = "Conversion rate measures effectiveness."
        guarded, issues = guard_final_claims(answer, [], "en")
        self.assertIn(answer, guarded)
        self.assertIn("retained for review", guarded)
        self.assertEqual(issues, ["review_required:conversion_claim"])


if __name__ == "__main__":
    unittest.main()
