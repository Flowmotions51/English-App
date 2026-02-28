package com.englishapp.service;

import com.englishapp.model.Sentence;
import com.englishapp.model.SentenceList;
import com.englishapp.repository.SentenceListRepository;
import com.englishapp.repository.SentenceRepository;
import com.englishapp.repository.SentenceReviewRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class MindMapService {
    private final SentenceRepository sentenceRepository;
    private final SentenceReviewRepository sentenceReviewRepository;
    private final SentenceListRepository sentenceListRepository;

    public MindMapService(SentenceRepository sentenceRepository,
                          SentenceReviewRepository sentenceReviewRepository,
                          SentenceListRepository sentenceListRepository) {
        this.sentenceRepository = sentenceRepository;
        this.sentenceReviewRepository = sentenceReviewRepository;
        this.sentenceListRepository = sentenceListRepository;
    }

    public Map<String, Object> listMindMap(Long userId, Long listId) {
        List<Sentence> sentences = sentenceRepository.findByListAndUser(listId, userId);
        Map<Long, Long> reviewCountBySentence = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);

        List<Map<String, Object>> nodes = new ArrayList<>();
        int index = 0;
        for (Sentence sentence : sentences) {
            long reviews = reviewCountBySentence.getOrDefault(sentence.getId(), 0L);
            double opacity = Math.min(1.0, 0.15 + (reviews * 0.2));
            int colorSeed = Math.abs(sentence.getId().hashCode() + sentence.getContent().hashCode());
            int hue = colorSeed % 360;
            nodes.add(Map.of(
                    "id", sentence.getId(),
                    "label", sentence.getContent(),
                    "reviews", reviews,
                    "opacity", opacity,
                    "color", "hsl(" + hue + " 80% 45%)",
                    "index", index++
            ));
        }
        return Map.of("listId", listId, "nodes", nodes);
    }

    public Map<String, Object> getAllMindMap(Long userId) {
        List<SentenceList> lists = sentenceListRepository.findByUserIdOrderByCreatedAtDesc(userId);
        Map<Long, Long> reviewCountBySentence = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);
        List<Map<String, Object>> nodes = new ArrayList<>();

        for (SentenceList list : lists) {
            List<Sentence> sentences = sentenceRepository.findByListAndUser(list.getId(), userId);
            int indexInList = 0;
            for (Sentence sentence : sentences) {
                long reviews = reviewCountBySentence.getOrDefault(sentence.getId(), 0L);
                double opacity = Math.min(1.0, 0.15 + (reviews * 0.2));
                int colorSeed = Math.abs(sentence.getId().hashCode() + sentence.getContent().hashCode());
                int hue = colorSeed % 360;
                Map<String, Object> node = new HashMap<>();
                node.put("id", sentence.getId());
                node.put("listId", list.getId());
                node.put("label", sentence.getContent());
                node.put("reviews", reviews);
                node.put("opacity", opacity);
                node.put("color", "hsl(" + hue + " 80% 45%)");
                node.put("index", indexInList++);
                nodes.add(node);
            }
        }
        return Map.of("nodes", nodes);
    }
}
