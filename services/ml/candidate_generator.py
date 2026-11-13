import os
import json
import random
from typing import List, Dict, Any, Optional

class CandidateGenerator:
    """
    Candidate Generator with support for mock generation, language tailoring, and LLM wrapping.
    Guarantees formats (image, reel, carousel) in candidate pools.
    """
    DEFAULT_FORMATS = ["image", "reel", "carousel"]

    def __init__(self, seed: Optional[int] = 42):
        if seed is not None:
            random.seed(seed)

    def _get_localized_captions(self, language: str, topic: str) -> List[str]:
        lang_lower = (language or "English").lower()
        if "urdu" in lang_lower or "hindi" in lang_lower:
            if "roman" in lang_lower or "bilingual" in lang_lower:
                return [
                    f"Aaj hum baat kar rahe hain {topic} ke baare mein! Aapka kya khayal hai? Comments mein zaroor batayein 👇",
                    f"{topic} ko behtar karne ke 3 ahem tareeqay jo aapki madad karenge #tips #growth",
                    f"Naya project shuru karne ke baad hum ne kya seekha? Aik mukhtasar jhalak #community #creator",
                    f"Aap konsa style prefer karte hain? Option A ya Option B? Hamen batayein!",
                    f"{topic} ke bare mein sab se ahem baat jo aksar log miss kar dete hain #strategy"
                ]
            else:
                return [
                    f"{topic} کے بارے میں سب سے اہم بات جو آپ کو معلوم ہونی چاہیے۔ اپنی رائے کا اظہار کریں 👇",
                    f"{topic} کو بہتر بنانے کے 3 خاص طریقے #tips #growth",
                    f"نیا تجربہ اور اس کے نتائج — آپ کی رائے کیا ہے؟",
                    f"{topic} پر خصوصی تفصیلی جائزہ #community #creator"
                ]
        elif "spanish" in lang_lower:
            return [
                f"¡Hoy exploramos estrategias clave para {topic}! Déjanos tu opinión en los comentarios 👇",
                f"3 consejos fundamentales sobre {topic} que cambiaron nuestro enfoque esta semana #tips #crecimiento",
                f"¿Cuál prefieres? ¿Opción A o B? ¡Cuéntanos abajo!",
                f"Un vistazo detrás de escena analizando {topic} y nuevas tendencias #estrategia #comunidad"
            ]
        elif "french" in lang_lower:
            return [
                f"Aujourd'hui, nous explorons les clés de {topic} ! Donnez votre avis en commentaire 👇",
                f"3 conseils essentiels sur {topic} pour booster votre audience cette semaine #astuces #conseils",
                f"Quelle option préférez-vous ? Dites-le nous en commentaire !",
                f"Retour sur notre parcours et les leçons apprises autour de {topic} #communauté #créateur"
            ]
        elif "portuguese" in lang_lower:
            return [
                f"Hoje estamos compartilhando as melhores dicas sobre {topic}! Deixe seu comentário abaixo 👇",
                f"3 passos simples para dominar {topic} sem complicação #dicas #crescimento",
                f"Qual versão você prefere? A ou B? Comenta aí!",
                f"Nosso resumo sobre {topic} e os aprendizados mais importantes deste mês #estratégia"
            ]
        else:
            return [
                f"Exploring key strategies in {topic}: what worked best for us this month. Drop your thoughts below 👇",
                f"The biggest misconception about {topic} and how to fix it today #tips #growth",
                f"3 simple frameworks to master {topic} without burning out #strategy",
                f"Quick question for the community: how do you approach {topic} in your workflow?",
                f"Behind the scenes looking at our newest insights on {topic} #creator #community"
            ]

    def generate_candidate_pool(
        self,
        n_candidates: int,
        creator_handle: str = "creator",
        follower_count: int = 150000,
        sample_captions: Optional[List[str]] = None,
        sample_hashtags: Optional[List[List[str]]] = None,
        language_preference: str = "English"
    ) -> List[Dict[str, Any]]:
        """
        Generate candidate pool spanning formats ('image', 'reel', 'carousel')
        ensuring format diversity across all candidates, aligned to preferred language.
        """
        if n_candidates <= 0:
            return []

        formats = self.DEFAULT_FORMATS
        pool: List[Dict[str, Any]] = []

        base_captions = sample_captions or self._get_localized_captions(language_preference, "growth and engagement")

        base_tag_sets = sample_hashtags or [
            ["productivity", "growth", "tips"],
            ["startup", "tech", "buildinpublic"],
            ["creative", "design", "workflow"],
            ["business", "marketing", "analytics"],
            ["community", "creator", "strategy"]
        ]

        for i in range(n_candidates):
            fmt = formats[i % len(formats)]
            cap = random.choice(base_captions)
            tags = random.choice(base_tag_sets)

            candidate = {
                "id": f"cand_{i+1:03d}",
                "creator_handle": creator_handle,
                "follower_count": follower_count,
                "media_type": fmt,
                "caption": cap,
                "hashtags": tags,
                "caption_length": len(cap),
                "hashtag_count": len(tags),
                "language": language_preference,
                "preferred_hour": random.randint(8, 21),
                "preferred_day": random.randint(0, 6)
            }
            pool.append(candidate)

        return pool

    def generate_candidates_llm(
        self,
        topic: str,
        n_candidates: int = 6,
        creator_handle: str = "creator",
        follower_count: int = 150000,
        language_preference: str = "English"
    ) -> List[Dict[str, Any]]:
        """
        Candidate generator honoring the creator's personalized detected language.
        """
        localized_samples = self._get_localized_captions(language_preference, topic)
        pool = self.generate_candidate_pool(
            n_candidates=n_candidates,
            creator_handle=creator_handle,
            follower_count=follower_count,
            sample_captions=localized_samples,
            language_preference=language_preference
        )
        return pool
