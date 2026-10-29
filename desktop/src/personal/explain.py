"""Saabas/treeinterpreter path decomposition of the raw forest regression.
Reference: https://github.com/andosa/treeinterpreter
This explains the estimator, not a causal effect on a listener or the final stochastic draw.
"""
import numpy as np

def decompose(forest, row):
    row = np.asarray(row,dtype=np.float32)  # sklearn's prediction input dtype
    contributions = np.zeros(len(row))
    bias = 0.
    for estimator in forest.estimators_:
        tree = estimator.tree_
        node = 0
        bias += tree.value[0,0,0]
        while tree.children_left[node] != -1:
            feature = tree.feature[node]
            child = tree.children_left[node] if row[feature] <= tree.threshold[node] else tree.children_right[node]
            contributions[feature] += tree.value[child,0,0] - tree.value[node,0,0]
            node = child
    return bias / len(forest.estimators_), contributions / len(forest.estimators_)


def factors(forest, row):
    _, contribution = decompose(forest,row)
    groups = [('history',0,5),('scenario',5,6),('semantic-audio',6,518),('spectrum',518,530),('timbre',530,554),('contrast',554,561),('clock',561,len(row))]
    values = [{'key':key,'delta':float(contribution[start:end].sum())} for key,start,end in groups if start<len(row)]
    return sorted((v for v in values if v['delta']!=0),key=lambda v:-abs(v['delta']))[:3]
